import Papa from "papaparse";
import type { EnvReadings, OlfactoryDataset, OlfactorySample } from "../types";

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
]);

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
  altitude: "altitudeM",
  altitudem: "altitudeM",
  elevation: "altitudeM",
  airquality: "airQuality",
  aqi: "airQuality",
  iaq: "airQuality",
  airqualityindex: "airQuality",
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

  // Classify each header once. Anything not recognised as coordinates, time,
  // env or metadata becomes a gas/feature channel — so new sensors in future
  // exports are picked up automatically.
  type Role =
    | "lat"
    | "lon"
    | "time"
    | "walkid"
    | "accuracy"
    | "ignore"
    | { env: keyof EnvReadings }
    | "feature";
  const roles = new Map<string, Role>();
  for (const h of headers) {
    const n = normalise(h);
    if (LAT_KEYS.has(n)) roles.set(h, "lat");
    else if (LON_KEYS.has(n)) roles.set(h, "lon");
    else if (TIME_KEYS.has(n)) roles.set(h, "time");
    else if (WALKID_KEYS.has(n)) roles.set(h, "walkid");
    else if (ACCURACY_KEYS.has(n)) roles.set(h, "accuracy");
    else if (IGNORE_KEYS.has(n)) roles.set(h, "ignore");
    else if (n in ENV_KEYS) roles.set(h, { env: ENV_KEYS[n] });
    else roles.set(h, "feature");
  }

  const featureChannels = headers.filter((h) => roles.get(h) === "feature");
  if (featureChannels.length === 0) {
    warnings.push("No feature/gas channels detected — clustering will be unavailable.");
  }

  const samples: OlfactorySample[] = [];
  const walkIdSet = new Set<string>();
  let droppedRows = 0;

  for (const row of res.data) {
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
      if (role === "lat") lat = Number(raw);
      else if (role === "lon") lon = Number(raw);
      else if (role === "time") timestamp = parseTimestamp(raw);
      else if (role === "walkid") {
        if (raw != null && raw !== "") walkId = String(raw);
      } else if (role === "accuracy") {
        const v = Number(raw);
        if (Number.isFinite(v)) accuracyM = v;
      } else if (role === "ignore") {
        // metadata — skip
      } else if (role === "feature") {
        const v = Number(raw);
        if (Number.isFinite(v)) features[h] = v;
      } else {
        const v = Number(raw);
        if (Number.isFinite(v)) env[role.env] = v;
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      droppedRows++;
      continue;
    }
    if (walkId) walkIdSet.add(walkId);
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

  if (samples.length === 0) {
    throw new Error(
      "No mappable rows found (every row was missing a valid lat/lon). Check the column names against docs/data-formats.md.",
    );
  }

  // Keep only channels present on the majority of samples so a stray column
  // doesn't wreck the clustering feature matrix.
  const usable = featureChannels.filter((c) => {
    const present = samples.filter((s) => c in s.features).length;
    return present >= samples.length * 0.5;
  });

  const walkIds = [...walkIdSet];
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
      walkIds,
    },
    droppedRows,
    warnings,
  };
}
