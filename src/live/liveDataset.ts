import type { OlfactoryDataset } from "../types";
import { buildOlfactoryDataset, rowsToSamples, type ParseResult } from "../olfactory/parseBrianCsv";
import type { LiveSnapshot } from "./brianBackend";

/**
 * Build an olfactory dataset from live snapshots, through the same row parser
 * as a CSV export so channel detection, env metrics and snapshot merging match.
 * Sensor keys are the BrianReactNative ones (CH4 … H2, TempC, PressureHPa,
 * HumidityPct, AltitudeM, GasResOhm); the parser maps the env keys.
 */
export function liveDataset(snapshots: LiveSnapshot[], name: string, walkId: string): ParseResult {
  const sensorKeys = new Set<string>();
  for (const s of snapshots) for (const key of Object.keys(s.readings)) sensorKeys.add(key);

  const meta = ["recorded_at", "latitude", "longitude", "accuracy_m", "walk_id"];
  const headers = [...meta, ...[...sensorKeys].filter((k) => !meta.includes(k))];
  const rows = snapshots.map((s) => ({
    ...s.readings,
    recorded_at: s.time,
    latitude: s.latitude,
    longitude: s.longitude,
    accuracy_m: s.accuracyM,
    walk_id: walkId,
  }));

  return buildOlfactoryDataset(rowsToSamples(headers, rows), name, []);
}

/** Merge newly fetched snapshots into the ones a layer already holds. */
export function appendSnapshots(existing: LiveSnapshot[], incoming: LiveSnapshot[]): LiveSnapshot[] {
  if (incoming.length === 0) return existing;
  const byTime = new Map(existing.map((s) => [s.time, s]));
  for (const s of incoming) byTime.set(s.time, s);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function emptyLiveDataset(name: string, walkId: string): OlfactoryDataset {
  return {
    kind: "olfactory",
    name,
    samples: [],
    featureChannels: [],
    envChannels: [],
    walkIds: [walkId],
    fingerprints: [],
  };
}
