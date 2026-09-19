// Read a GPS track embedded in an audio file's metadata, so a recording can be
// mapped on its own — no separate GPX needed.
//
// The Android app **GPS Audio Recorder**
// (https://play.google.com/store/apps/details?id=com.gpsaudiorecorder) writes
// the walk track into the M4A/MP4 container as an iTunes-style freeform tag
// `----:com.apple.iTunes:rGPS`, whose payload is JSON:
//
//   { "v": 1,
//     "start": [lat, lon],
//     "path":  [[lat, lon, unixSeconds, accuracyM], ...] }
//
// Unlike a GPX, the path timestamps are absolute Unix epochs, so we also learn
// the audio's start time (second 0 == the first fix) and can skip the manual
// time-sync step entirely.
//
// We parse the MP4 box tree by hand (no dependency) and only reach into
// moov > udta > meta > ilst, so the audio samples are never touched. Anything
// unexpected — a different format, a missing or malformed tag — resolves to
// `null`, and the caller falls back to the GPX flow.

import type { GpxTrack, TrackPoint } from "../types";
import { readArrayBuffer } from "../lib/readFile";

export interface EmbeddedTrackResult {
  track: GpxTrack;
  /** Epoch ms for second 0 of the audio (the first GPS fix). */
  audioStartEpoch: number;
}

const FOURCC = (view: DataView, off: number): string =>
  String.fromCharCode(
    view.getUint8(off),
    view.getUint8(off + 1),
    view.getUint8(off + 2),
    view.getUint8(off + 3),
  );

interface Box {
  type: string;
  /** Offset of this box's payload (after the size+type header). */
  start: number;
  /** Offset one past the end of this box. */
  end: number;
}

/** Iterate the boxes directly inside [from, to). Tolerates truncation. */
function* boxes(view: DataView, from: number, to: number): Generator<Box> {
  let off = from;
  while (off + 8 <= to) {
    let size = view.getUint32(off);
    let headerLen = 8;
    if (size === 1) {
      // 64-bit largesize. We only handle sizes within Number's safe range.
      if (off + 16 > to) break;
      const hi = view.getUint32(off + 8);
      const lo = view.getUint32(off + 12);
      size = hi * 2 ** 32 + lo;
      headerLen = 16;
    } else if (size === 0) {
      // Extends to the end of the enclosing range.
      size = to - off;
    }
    if (size < headerLen || off + size > to) break;
    const type = FOURCC(view, off + 4);
    yield { type, start: off + headerLen, end: off + size };
    off += size;
  }
}

/** First child box of `type` within [from, to), or null. */
function findBox(view: DataView, from: number, to: number, type: string): Box | null {
  for (const b of boxes(view, from, to)) {
    if (b.type === type) return b;
  }
  return null;
}

/**
 * `meta` is a FullBox (4-byte version+flags before its children) in iTunes/MP4
 * files, but a plain container in some QuickTime files. Detect which by peeking
 * for a sensible child box at each candidate offset.
 */
function metaChildrenStart(view: DataView, meta: Box): number {
  const withFlags = meta.start + 4;
  if (withFlags + 8 <= meta.end) {
    const size = view.getUint32(withFlags);
    if (size >= 8 && meta.start + 4 + size <= meta.end + 8) return withFlags;
  }
  return meta.start;
}

/** Payload bytes of the `----:*:rGPS` freeform tag inside `ilst`, or null. */
function findRgpsData(view: DataView, ilst: Box): Uint8Array | null {
  for (const item of boxes(view, ilst.start, ilst.end)) {
    if (item.type !== "----") continue;

    let name: string | null = null;
    let data: { off: number; len: number } | null = null;
    for (const field of boxes(view, item.start, item.end)) {
      if (field.type === "name") {
        // name = size + 'name' + version/flags(4) + utf8 name
        const s = field.start + 4;
        name = new TextDecoder().decode(
          new Uint8Array(view.buffer, view.byteOffset + s, field.end - s),
        );
      } else if (field.type === "data") {
        // data = size + 'data' + type(4) + locale(4) + payload
        const s = field.start + 8;
        data = { off: s, len: field.end - s };
      }
    }
    if (name === "rGPS" && data && data.len > 0) {
      return new Uint8Array(view.buffer, view.byteOffset + data.off, data.len);
    }
  }
  return null;
}

/** Build a GpxTrack from the decoded rGPS JSON payload, or null if unusable. */
function trackFromRgpsJson(json: unknown, fallbackName: string): EmbeddedTrackResult | null {
  if (!json || typeof json !== "object") return null;
  const path = (json as { path?: unknown }).path;
  if (!Array.isArray(path)) return null;

  const points: TrackPoint[] = [];
  for (const entry of path) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const lat = Number(entry[0]);
    const lon = Number(entry[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const secs = Number(entry[2]);
    const timestamp = Number.isFinite(secs) ? secs * 1000 : NaN;
    points.push({ lat, lon, timestamp });
  }
  if (points.length === 0) return null;

  const timed = points.filter((p) => Number.isFinite(p.timestamp));
  timed.sort((a, b) => a.timestamp - b.timestamp);
  const ordered = timed.length ? timed : points;

  const audioStartEpoch = timed.length ? timed[0].timestamp : NaN;
  return {
    track: { name: fallbackName, points: ordered },
    audioStartEpoch,
  };
}

/**
 * Extract an embedded GPS track from an audio file, or `null` when the file has
 * no recognised track (any non-MP4 file, or an MP4 without the rGPS tag). Never
 * throws for an unrecognised file — the caller treats `null` as "use GPX".
 */
export async function extractEmbeddedTrack(file: File): Promise<EmbeddedTrackResult | null> {
  let buf: ArrayBuffer;
  try {
    buf = await readArrayBuffer(file);
  } catch {
    return null;
  }
  try {
    const view = new DataView(buf);
    if (view.byteLength < 8) return null;

    const moov = findBox(view, 0, view.byteLength, "moov");
    if (!moov) return null;
    const udta = findBox(view, moov.start, moov.end, "udta");
    if (!udta) return null;
    const meta = findBox(view, udta.start, udta.end, "meta");
    if (!meta) return null;
    const childStart = metaChildrenStart(view, meta);
    const ilst = findBox(view, childStart, meta.end, "ilst");
    if (!ilst) return null;

    const payload = findRgpsData(view, ilst);
    if (!payload) return null;

    const json = JSON.parse(new TextDecoder().decode(payload));
    return trackFromRgpsJson(json, file.name);
  } catch {
    return null;
  }
}
