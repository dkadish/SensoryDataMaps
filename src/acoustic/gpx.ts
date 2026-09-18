import type { GpxTrack, TrackPoint } from "../types";

/** Parse a GPX 1.1 file, reading only <trkpt> track points. */
export function parseGpx(text: string, fallbackName: string): GpxTrack {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Could not parse GPX file (invalid XML).");
  }

  const nameEl =
    doc.querySelector("trk > name") ?? doc.querySelector("metadata > name");
  const name = nameEl?.textContent?.trim() || fallbackName;

  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  const points: TrackPoint[] = [];
  for (const pt of trkpts) {
    const lat = Number(pt.getAttribute("lat"));
    const lon = Number(pt.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const timeEl = pt.getElementsByTagName("time")[0];
    const timestamp = timeEl ? Date.parse(timeEl.textContent ?? "") : NaN;

    const eleEl = pt.getElementsByTagName("ele")[0];
    const ele = eleEl ? Number(eleEl.textContent) : NaN;

    points.push({
      lat,
      lon,
      timestamp,
      elevation: Number.isFinite(ele) ? ele : undefined,
    });
  }

  if (points.length === 0) {
    throw new Error("No <trkpt> points found in the GPX file.");
  }

  const timed = points.filter((p) => Number.isFinite(p.timestamp));
  timed.sort((a, b) => a.timestamp - b.timestamp);

  return { name, points: timed.length ? timed : points };
}

/** Epoch-ms range of the timed track points, or null if none are timed. */
export function trackTimeRange(track: GpxTrack): [number, number] | null {
  const ts = track.points.map((p) => p.timestamp).filter(Number.isFinite);
  if (ts.length === 0) return null;
  return [ts[0], ts[ts.length - 1]];
}
