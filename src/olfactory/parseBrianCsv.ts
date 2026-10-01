import Papa from "papaparse";
import type { EnvChannel, EnvKey, EnvReadings, OlfactoryDataset, OlfactorySample } from "../types";
import { ENV_LABELS, ENV_ORDER } from "./values";

// Header synonyms -> canonical role. Keys are normalised (lowercase, no spaces
// or underscores). See docs/data-formats.md.
const LAT_KEYS = new Set(["lat", "latitude"]);
const LON_KEYS = new Set(["lon", "lng", "long", "longitude"]);
const TIME_KEYS = new Set([
  "timestamp",
  "time",
  "datetime",
  "isotime",
  "recordedat",
  "recorded",
  "date",
  "ts",
]);
const WALKID_KEYS = new Set(["walkid", "walk", "trackid", "session", "sessionid"]);
const ACCURACY_KEYS = new Set(["accuracym", "accuracy", "accuracymeters", "gpsaccuracy", "hacc"]);

// Numeric columns that are metadata, not gas sensors — excluded from clustering.
const IGNORE_KEYS = new Set([
  "id",
  "index",
  "seq",
  "sample",
  "sampleindex",
  "hdop",
  "vdop",
  "pdop",
  "satellites",
  "sats",
  "speed",
  "heading",
  "bearing",
  "course",
  "fix",
  // BrianReactNative sensor-record bookkeeping (walk_samples.json /
  // fingerprints.json in a zip export).
  "title",
  "description",
  "recordtype",
  "tagsjson",
  "photopath",
  "syncstatus",
  "syncedat",
  "influxstatus",
  "influxsyncedat",
  "influxlasterror",
]);

// Column prefixes that are bookkeeping, not sensors (e.g. `deltaCh4`, a
// fingerprint's change against a baseline; `influxStatus`).
const IGNORE_PREFIXES = ["delta", "influx", "sync"];

const ENV_KEYS: Record<string, keyof EnvReadings> = {
  temperature: "temperatureC",
  temperaturec: "temperatureC",
  temp: "temperatureC",
  pressure: "pressureHpa",
  pressurehpa: "pressureHpa",
  barometricpressure: "pressureHpa",
  humidity: "humidityPct",
  humiditypct: "humidityPct",
  rh: "humidityPct",
  gasresistance: "gasResistanceOhm",
  gasresistanceohm: "gasResistanceOhm",
  vocohm: "gasResistanceOhm",
  // BME680 "air quality" is its gas-resistance reading.
  airquality: "gasResistanceOhm",
  aqi: "gasResistanceOhm",
  iaq: "gasResistanceOhm",
  airqualityindex: "gasResistanceOhm",
  // BRIAN smell-walk export (BrianReactNative): `bme680_gas_resistance`.
  bme680gasresistance: "gasResistanceOhm",
  altitude: "altitudeM",
  altitudem: "altitudeM",
  elevation: "altitudeM",
};

function normalise(key: string): string {
  return key.toLowerCase().replace(/[\s_]+/g, "");
}

/** Parse a timestamp cell into epoch ms, or NaN. Accepts ISO strings and
 *  Unix seconds/milliseconds. */
export function parseTimestamp(value: unknown): number {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") {
    // Heuristic: >1e12 already ms; otherwise treat as seconds.
    return value > 1e12 ? value : value * 1000;
  }
  const s = String(value).trim();
  const asNum = Number(s);
  if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(s)) {
    return asNum > 1e12 ? asNum : asNum * 1000;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export interface ParseResult {
  dataset: OlfactoryDataset;
  droppedRows: number;
  warnings: string[];
}

type Role =
  | "lat"
  | "lon"
  | "time"
  | "walkid"
  | "accuracy"
  | "ignore"
  | { env: keyof EnvReadings }
  | "feature";

function classifyHeader(h: string): Role {
  const n = normalise(h);
  if (LAT_KEYS.has(n)) return "lat";
  if (LON_KEYS.has(n)) return "lon";
  if (TIME_KEYS.has(n)) return "time";
  if (WALKID_KEYS.has(n)) return "walkid";
  if (ACCURACY_KEYS.has(n)) return "accuracy";
  if (IGNORE_KEYS.has(n) || IGNORE_PREFIXES.some((p) => n.startsWith(p))) return "ignore";
  if (n in ENV_KEYS) return { env: ENV_KEYS[n] };
  return "feature";
}

/** A numeric cell, or NaN when empty/null. `Number("")` and `Number(null)` are
 *  0, which would turn a missing reading into a bogus zero. */
function toNumber(raw: unknown): number {
  if (raw == null || raw === "" || typeof raw === "boolean") return NaN;
  return Number(raw);
}

export interface RowsResult {
  samples: OlfactorySample[];
  /** Header names classified as gas/feature channels, in column order. */
  featureChannels: string[];
  droppedRows: number;
}

/**
 * Turn generic rows (from a CSV, or JSON records) into samples. Anything not
 * recognised as coordinates, time, env or metadata becomes a gas/feature
 * channel — so new sensors in future exports are picked up automatically.
 */
export function rowsToSamples(
  headers: string[],
  rows: Record<string, unknown>[],
): RowsResult {
  const roles = new Map<string, Role>();
  for (const h of headers) roles.set(h, classifyHeader(h));
  const featureChannels = headers.filter((h) => roles.get(h) === "feature");

  const samples: OlfactorySample[] = [];
  let droppedRows = 0;

  for (const row of rows) {
    let lat = NaN;
    let lon = NaN;
    let timestamp = NaN;
    let walkId: string | undefined;
    let accuracyM: number | undefined;
    const features: Record<string, number> = {};
    const env: EnvReadings = {};

    for (const h of headers) {
      const role = roles.get(h)!;
      const raw = row[h];
      if (role === "lat") lat = toNumber(raw);
      else if (role === "lon") lon = toNumber(raw);
      else if (role === "time") timestamp = parseTimestamp(raw);
      else if (role === "walkid") {
        if (raw != null && raw !== "") walkId = String(raw);
      } else if (role === "accuracy") {
        const v = toNumber(raw);
        if (Number.isFinite(v)) accuracyM = v;
      } else if (role === "ignore") {
        // metadata — skip
      } else if (role === "feature") {
        const v = toNumber(raw);
        if (Number.isFinite(v)) features[h] = v;
      } else {
        const v = toNumber(raw);
        if (Number.isFinite(v)) env[role.env] = v;
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      droppedRows++;
      continue;
    }
    samples.push({
      lat,
      lon,
      timestamp,
      features,
      env: Object.keys(env).length ? env : undefined,
      walkId,
      accuracyM,
    });
  }

  return { samples, featureChannels, droppedRows };
}

function readingCount(s: OlfactorySample): number {
  return Object.keys(s.features).length + (s.env ? Object.keys(s.env).length : 0);
}

/** Largest time span (ms) one merged snapshot may cover. The BRIAN firmware
 *  notifies every channel in a quick burst and then waits 5 s, so one burst is
 *  well inside this. */
export const SNAPSHOT_MAX_SPAN_MS = 8000;

/**
 * Combine partial rows into whole sensor snapshots.
 *
 * The BRIAN app stores readings as they arrive, so one firmware burst can be
 * split over consecutive rows (e.g. one row with 15 channels and the next with
 * only `etoh`). Consecutive rows from the same walk are merged while they don't
 * both carry a value for the same channel and stay within
 * `SNAPSHOT_MAX_SPAN_MS`. A complete row always conflicts with its neighbour, so
 * dense exports pass through unchanged. The merged sample takes its position,
 * time and GPS accuracy from the row that contributed the most readings.
 */
export function mergePartialSamples(samples: OlfactorySample[]): OlfactorySample[] {
  const out: OlfactorySample[] = [];
  let group: OlfactorySample[] = [];
  let keys = new Set<string>();

  const flush = () => {
    if (group.length === 0) return;
    if (group.length === 1) {
      out.push(group[0]);
    } else {
      const anchor = group.reduce((best, s) => (readingCount(s) > readingCount(best) ? s : best));
      const features: Record<string, number> = {};
      const env: EnvReadings = {};
      for (const s of group) {
        Object.assign(features, s.features);
        if (s.env) Object.assign(env, s.env);
      }
      out.push({
        ...anchor,
        features,
        env: Object.keys(env).length ? env : undefined,
      });
    }
    group = [];
    keys = new Set();
  };

  for (const s of samples) {
    const sKeys = [...Object.keys(s.features), ...Object.keys(s.env ?? {}).map((k) => `env:${k}`)];
    const first = group[0];
    const fits =
      first !== undefined &&
      s.walkId === first.walkId &&
      Number.isFinite(s.timestamp) &&
      Number.isFinite(first.timestamp) &&
      s.timestamp >= first.timestamp &&
      s.timestamp - first.timestamp <= SNAPSHOT_MAX_SPAN_MS &&
      !sKeys.some((k) => keys.has(k));
    if (!fits) flush();
    group.push(s);
    for (const k of sKeys) keys.add(k);
  }
  flush();
  return out;
}

/**
 * Finish a dataset from parsed samples: merge partial rows into snapshots, keep
 * the channels present on most samples and collect walk ids.
 */
export function buildOlfactoryDataset(
  rowsResult: RowsResult,
  name: string,
  warnings: string[],
): ParseResult {
  const { featureChannels, droppedRows } = rowsResult;
  if (featureChannels.length === 0) {
    warnings.push("No feature/gas channels detected — clustering will be unavailable.");
  }
  if (rowsResult.samples.length === 0) {
    throw new Error(
      "No mappable rows found (every row was missing a valid lat/lon). Check the column names against docs/data-formats.md.",
    );
  }

  const samples = mergePartialSamples(rowsResult.samples);
  const merged = rowsResult.samples.length - samples.length;
  if (merged > 0) {
    warnings.push(
      `Combined ${rowsResult.samples.length} partial rows into ${samples.length} sensor snapshots`,
    );
  }

  // Keep only channels present on the majority of samples so a stray column
  // doesn't wreck the clustering feature matrix.
  const usable = featureChannels.filter((c) => {
    const present = samples.filter((s) => c in s.features).length;
    return present >= samples.length * 0.5;
  });

  // Environmental metrics present on most samples become opt-in inputs.
  const envChannels: EnvChannel[] = ENV_ORDER.filter((key: EnvKey) => {
    const present = samples.filter((s) => s.env && Number.isFinite(s.env[key])).length;
    return present >= samples.length * 0.5;
  }).map((key) => ({ key, label: ENV_LABELS[key] }));

  const walkIds = [...new Set(samples.map((s) => s.walkId).filter((w): w is string => !!w))];
  if (walkIds.length > 1) {
    warnings.push(
      `File contains ${walkIds.length} walk ids; all rows are shown together (per-walk split is on the roadmap).`,
    );
  }

  return {
    dataset: {
      kind: "olfactory",
      name,
      samples,
      featureChannels: usable,
      envChannels,
      walkIds,
      fingerprints: [],
    },
    droppedRows,
    warnings,
  };
}

export function parseBrianCsv(text: string, name: string): ParseResult {
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const warnings: string[] = [];
  if (res.errors.length) {
    warnings.push(`${res.errors.length} CSV parse warning(s); first: ${res.errors[0].message}`);
  }

  const headers = res.meta.fields ?? [];
  if (headers.length === 0) {
    throw new Error("CSV has no header row.");
  }

  return buildOlfactoryDataset(rowsToSamples(headers, res.data), name, warnings);
}
