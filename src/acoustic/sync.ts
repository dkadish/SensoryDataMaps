import type { AcousticSegment, GeoPoint, GpxTrack, TrackPoint } from "../types";

/** Linearly interpolate a location on the track at epoch-ms time `t`. */
export function interpolateTrack(points: TrackPoint[], t: number): GeoPoint | null {
  if (points.length === 0) return null;
  if (t < points[0].timestamp || t > points[points.length - 1].timestamp) {
    return null;
  }
  // Binary search for the last point with timestamp <= t.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].timestamp <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo];
  const b = points[Math.min(lo + 1, points.length - 1)];
  if (a === b || b.timestamp === a.timestamp) return { lat: a.lat, lon: a.lon };
  const f = (t - a.timestamp) / (b.timestamp - a.timestamp);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
  };
}

export interface SyncOptions {
  /** Epoch ms corresponding to second 0 of the audio file. */
  audioStartEpoch: number;
  /** Manual fine adjustment (seconds) added to the audio clock. */
  offsetSec: number;
}

/**
 * Attach a timestamp and interpolated lat/lon to each segment, using its centre
 * time. Segments outside the track's time span are returned without a location.
 */
export function locateSegments(
  segments: AcousticSegment[],
  track: GpxTrack,
  opts: SyncOptions,
): AcousticSegment[] {
  const pts = track.points.filter((p) => Number.isFinite(p.timestamp));
  return segments.map((seg) => {
    const centerSec = (seg.startSec + seg.endSec) / 2 + opts.offsetSec;
    const timestamp = opts.audioStartEpoch + centerSec * 1000;
    const loc = interpolateTrack(pts, timestamp);
    return {
      ...seg,
      timestamp,
      lat: loc?.lat,
      lon: loc?.lon,
    };
  });
}
