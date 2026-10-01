import { unzipSync, strFromU8 } from "fflate";
import Papa from "papaparse";
import type { FingerprintMedia, OlfactoryFingerprint } from "../types";
import { buildOlfactoryDataset, rowsToSamples, type ParseResult } from "./parseBrianCsv";

// Reader for the per-walk zip exported by the BRIAN app (BrianReactNative,
// `exportSmellWalkZip`). See docs/data-formats.md, section 1b.
//
//   samples.csv          the walk's sensor rows (same layout as the CSV export)
//   walk_samples.json    the same rows as app sensor records (+ device id)
//   fingerprints.json    user-captured fingerprints (sensor records)
//   captures.json        photo / audio notes, linked by sensorRecordId
//   annotations.json     drawings + tags on captures
//   media/<type>_<captureId>.<jpg|m4a>

type Json = Record<string, unknown>;

/** True when the bytes start with a zip local-file header ("PK\x03\x04"). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function parseJsonArray(text: string | undefined, file: string, warnings: string[]): Json[] {
  if (text == null) return [];
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v.filter((x): x is Json => !!x && typeof x === "object");
    warnings.push(`${file} is not a JSON array; ignored.`);
  } catch (e) {
    warnings.push(`${file} could not be parsed (${e instanceof Error ? e.message : e}); ignored.`);
  }
  return [];
}

function parseStringList(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function transcriptText(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  try {
    const t = JSON.parse(raw) as { phrases?: { text?: string }[] };
    return (t.phrases ?? []).map((p) => p.text ?? "").join(" ").trim();
  } catch {
    return "";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", m4a: "audio/mp4" };

export function parseBrianZip(bytes: Uint8Array, name: string): ParseResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => !f.name.startsWith("__MACOSX/") });
  } catch (e) {
    throw new Error(`Couldn't open the zip: ${e instanceof Error ? e.message : e}`);
  }

  // Files may sit at the root or inside one folder, so match by base name.
  const files = new Map<string, Uint8Array>();
  const media = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    if (/(^|\/)media\//.test(path)) media.set(baseName(path), data);
    else files.set(baseName(path), data);
  }
  const text = (file: string) => {
    const d = files.get(file);
    return d ? strFromU8(d) : undefined;
  };

  const warnings: string[] = [];

  // Walk samples: prefer the JSON records (exact ms timestamps + device id);
  // fall back to samples.csv.
  const walkJson = parseJsonArray(text("walk_samples.json"), "walk_samples.json", warnings);
  let rowsResult;
  const deviceIds = new Set<string>();
  if (walkJson.length > 0) {
    const headers = [...new Set(walkJson.flatMap((r) => Object.keys(r)))];
    rowsResult = rowsToSamples(headers, walkJson);
    // Walk rows store the BLE device id in `description`.
    for (const r of walkJson) if (str(r.description)) deviceIds.add(str(r.description));
  } else {
    const csv = text("samples.csv");
    if (csv == null) {
      throw new Error(
        "This zip has no samples.csv or walk_samples.json — is it a BRIAN smell-walk export?",
      );
    }
    const res = Papa.parse<Record<string, unknown>>(csv, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    rowsResult = rowsToSamples(res.meta.fields ?? [], res.data);
  }

  const result = buildOlfactoryDataset(rowsResult, name, warnings);
  if (deviceIds.size) warnings.unshift(`Device ${[...deviceIds].join(", ")}`);

  // Media: captures point at media/<type>_<id>.<ext>; annotations add tags.
  const captures = parseJsonArray(text("captures.json"), "captures.json", warnings);
  const annotations = parseJsonArray(text("annotations.json"), "annotations.json", warnings);
  const urlFor = (type: string, id: string): string | undefined => {
    for (const [file, data] of media) {
      if (!file.startsWith(`${type}_${id}.`)) continue;
      const ext = file.split(".").pop()!.toLowerCase();
      const blob = new Blob([data as BlobPart], { type: MIME[ext] ?? "application/octet-stream" });
      return URL.createObjectURL(blob);
    }
    return undefined;
  };
  const tagsByCapture = new Map<string, string[]>();
  for (const a of annotations) {
    const id = str(a.captureId);
    if (id) tagsByCapture.set(id, [...(tagsByCapture.get(id) ?? []), ...parseStringList(a.selectedTagsJson)]);
  }
  const mediaOf = (c: Json): FingerprintMedia => {
    const type = c.type === "audio" ? "audio" : "photo";
    const text = str(c.description) || transcriptText(c.transcriptJson);
    return { type, url: urlFor(type, str(c.id)), text: text || undefined };
  };
  const captureTags = (c: Json) => [
    ...parseStringList(c.selectedTagsJson),
    ...(tagsByCapture.get(str(c.id)) ?? []),
  ];

  // Fingerprints are sensor records with a title/description/tags.
  const fpJson = parseJsonArray(text("fingerprints.json"), "fingerprints.json", warnings);
  const fingerprints: OlfactoryFingerprint[] = [];
  let unplaced = 0;
  for (const r of fpJson) {
    const [sample] = rowsToSamples(Object.keys(r), [r]).samples;
    if (!sample) {
      unplaced++;
      continue;
    }
    const id = str(r.id);
    const own = captures.filter((c) => str(c.sensorRecordId) === id);
    fingerprints.push({
      ...sample,
      id,
      title: str(r.title) || "Fingerprint",
      description: str(r.description),
      tags: [...new Set([...parseStringList(r.tagsJson), ...own.flatMap(captureTags)])],
      media: own.map(mediaOf),
    });
  }

  // Free-standing photo/audio notes (not attached to a fingerprint) that have
  // a location become fingerprints without sensor readings.
  const fpIds = new Set(fpJson.map((r) => str(r.id)));
  for (const c of captures) {
    if (fpIds.has(str(c.sensorRecordId))) continue;
    const lat = Number(c.latitudeRaw);
    const lon = Number(c.longitudeRaw);
    if (c.latitudeRaw == null || c.longitudeRaw == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      unplaced++;
      continue;
    }
    const m = mediaOf(c);
    fingerprints.push({
      lat,
      lon,
      timestamp: Number(c.capturedAt),
      features: {},
      walkId: str(c.walkId) || undefined,
      id: str(c.id),
      title: m.type === "audio" ? "Audio note" : "Photo note",
      description: "",
      tags: [...new Set(captureTags(c))],
      media: [m],
    });
  }

  fingerprints.sort((a, b) => a.timestamp - b.timestamp);
  result.dataset.fingerprints = fingerprints;
  if (fingerprints.length) warnings.push(`${fingerprints.length} fingerprint(s)/notes`);
  if (unplaced) warnings.push(`${unplaced} fingerprint(s)/notes without GPS skipped`);
  return result;
}
