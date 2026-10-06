// Parse context geodata — GeoJSON, GPX, KML or KMZ — into a GeoJSON
// FeatureCollection that the map can draw as a reference layer (paths, areas,
// points of interest) beneath the sensory layers.
//
// GPX and KML are converted with a small built-in reader rather than a library:
// we only need geometry plus a name/description/attribute table for popups, not
// styles, icons or timestamps.

import { unzipSync, strFromU8 } from "fflate";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties, Position } from "geojson";

export type GeoFormat = "geojson" | "gpx" | "kml" | "kmz";

export interface ParsedGeo {
  format: GeoFormat;
  /** A name from inside the file (GPX/KML document name), when it has one. */
  name?: string;
  data: FeatureCollection;
  warnings: string[];
}

/** Extensions offered in the file picker. */
export const GEO_ACCEPT =
  ".geojson,.json,.gpx,.kml,.kmz,application/geo+json,application/json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz";

/** Work out the format from the file name, falling back to sniffing the content. */
export function detectGeoFormat(fileName: string, bytes: Uint8Array): GeoFormat {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "kmz") return "kmz";
  if (ext === "kml") return "kml";
  if (ext === "gpx") return "gpx";
  if (ext === "geojson" || ext === "json") return "geojson";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "kmz";
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).trimStart();
  if (head.startsWith("{")) return "geojson";
  if (/<gpx[\s>]/i.test(head)) return "gpx";
  if (/<kml[\s>]/i.test(head)) return "kml";
  throw new Error("Unrecognised file. Use GeoJSON (.geojson/.json), GPX (.gpx) or KML/KMZ (.kml/.kmz).");
}

export function parseGeoFile(fileName: string, bytes: Uint8Array): ParsedGeo {
  const format = detectGeoFormat(fileName, bytes);
  const warnings: string[] = [];
  let name: string | undefined;
  let features: Feature[];

  if (format === "geojson") {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("Could not parse GeoJSON (invalid JSON).");
    }
    ({ features, name } = fromGeoJson(json));
  } else if (format === "kmz") {
    ({ features, name } = parseKml(kmlFromKmz(bytes)));
  } else {
    const doc = parseXml(new TextDecoder().decode(bytes), format.toUpperCase());
    ({ features, name } = format === "gpx" ? parseGpxDoc(doc) : parseKmlDoc(doc));
  }

  const withCoords = features.filter((f) => f.geometry && hasCoords(f.geometry));
  const skipped = features.length - withCoords.length;
  if (skipped) warnings.push(`${plural(skipped, "feature")} without coordinates skipped`);
  // GeoJSON must be WGS84 lon/lat. A projected CRS (e.g. SWEREF 99 TM) gives
  // metre values that can't be placed on the map, so drop those features.
  const kept = withCoords.filter((f) => inLatLonRange(f.geometry));
  const projected = withCoords.length - kept.length;
  const reproject = "the file may use a projected coordinate system; reproject it to WGS84 (EPSG:4326)";
  if (withCoords.length > 0 && kept.length === 0) {
    throw new Error(`No coordinates are valid longitude/latitude — ${reproject}.`);
  }
  if (kept.length === 0) throw new Error("No mappable features found in the file.");
  if (projected) {
    warnings.push(`${plural(projected, "feature")} outside the longitude/latitude range skipped — ${reproject}`);
  }
  return { format, name, data: { type: "FeatureCollection", features: kept }, warnings };
}

// --- GeoJSON ---------------------------------------------------------------

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function fromGeoJson(json: unknown): { features: Feature[]; name?: string } {
  const obj = json as { type?: unknown; name?: unknown; features?: unknown };
  const name = typeof obj?.name === "string" ? obj.name : undefined;
  if (obj?.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return { features: (obj.features as Feature[]).filter((f) => f?.type === "Feature"), name };
  }
  if (obj?.type === "Feature") return { features: [obj as unknown as Feature], name };
  if (typeof obj?.type === "string" && GEOMETRY_TYPES.has(obj.type)) {
    return { features: [feature(obj as unknown as Geometry, {})] };
  }
  throw new Error("Not a GeoJSON FeatureCollection, Feature or geometry.");
}

// --- XML helpers -------------------------------------------------------------

function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`Could not parse ${label} file (invalid XML).`);
  }
  return doc;
}

/** Direct children with the given local name (namespace prefixes ignored). */
function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

function child(el: Element, name: string): Element | undefined {
  return children(el, name)[0];
}

/** All descendants with the given local name. */
function descendants(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", name));
}

function childText(el: Element, name: string): string | undefined {
  const t = child(el, name)?.textContent?.trim();
  return t ? t : undefined;
}

function feature(geometry: Geometry, properties: GeoJsonProperties): Feature {
  return { type: "Feature", geometry, properties };
}

/** Drop undefined values so popups only list what the file actually has. */
function props(entries: Record<string, string | undefined>): GeoJsonProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) if (v !== undefined) out[k] = v;
  return out;
}

// --- GPX ---------------------------------------------------------------------

function gpxPoint(el: Element): Position | null {
  const lat = Number(el.getAttribute("lat"));
  const lon = Number(el.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ele = Number(childText(el, "ele"));
  return Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
}

function gpxPoints(parent: Element, name: string): Position[] {
  return children(parent, name)
    .map(gpxPoint)
    .filter((p): p is Position => p !== null);
}

function gpxProps(el: Element): GeoJsonProperties {
  return props({
    name: childText(el, "name"),
    description: childText(el, "desc") ?? childText(el, "cmt"),
    type: childText(el, "type"),
  });
}

function parseGpxDoc(doc: Document): { features: Feature[]; name?: string } {
  const root = doc.documentElement;
  const meta = child(root, "metadata");
  const name = meta ? childText(meta, "name") : undefined;
  const features: Feature[] = [];

  for (const wpt of children(root, "wpt")) {
    const p = gpxPoint(wpt);
    if (p) features.push(feature({ type: "Point", coordinates: p }, gpxProps(wpt)));
  }
  for (const rte of children(root, "rte")) {
    const coords = gpxPoints(rte, "rtept");
    if (coords.length > 1) {
      features.push(feature({ type: "LineString", coordinates: coords }, gpxProps(rte)));
    }
  }
  for (const trk of children(root, "trk")) {
    const segs = children(trk, "trkseg")
      .map((s) => gpxPoints(s, "trkpt"))
      .filter((s) => s.length > 1);
    if (segs.length === 0) continue;
    const geometry: Geometry =
      segs.length === 1
        ? { type: "LineString", coordinates: segs[0] }
        : { type: "MultiLineString", coordinates: segs };
    features.push(feature(geometry, gpxProps(trk)));
  }
  return { features, name };
}

// --- KML / KMZ -------------------------------------------------------------

function kmlFromKmz(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Could not open KMZ file (invalid zip).");
  }
  // By convention the main document is doc.kml at the root; otherwise take
  // the first .kml in the archive.
  const names = Object.keys(files).filter((n) => n.toLowerCase().endsWith(".kml"));
  const main = names.find((n) => n.toLowerCase() === "doc.kml") ?? names.sort()[0];
  if (!main) throw new Error("No .kml document found inside the KMZ file.");
  return strFromU8(files[main]);
}

function parseKml(text: string): { features: Feature[]; name?: string } {
  return parseKmlDoc(parseXml(text, "KML"));
}

/** KML coordinates: whitespace-separated "lon,lat[,alt]" tuples. */
function kmlCoords(el: Element | undefined): Position[] {
  const text = el ? child(el, "coordinates")?.textContent : undefined;
  if (!text) return [];
  const out: Position[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const nums = tuple.split(",").map(Number);
    if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) continue;
    out.push(Number.isFinite(nums[2]) ? [nums[0], nums[1], nums[2]] : [nums[0], nums[1]]);
  }
  return out;
}

/** gx:Track: parallel <gx:coord>"lon lat alt"</gx:coord> elements. */
function kmlTrackCoords(el: Element): Position[] {
  return children(el, "coord")
    .map((c) => (c.textContent ?? "").trim().split(/\s+/).map(Number))
    .filter((n) => n.length >= 2 && Number.isFinite(n[0]) && Number.isFinite(n[1]))
    .map((n) => (Number.isFinite(n[2]) ? [n[0], n[1], n[2]] : [n[0], n[1]]));
}

function kmlGeometry(el: Element): Geometry | null {
  switch (el.localName) {
    case "Point": {
      const c = kmlCoords(el);
      return c.length ? { type: "Point", coordinates: c[0] } : null;
    }
    case "LineString":
    case "LinearRing": {
      const c = kmlCoords(el);
      return c.length > 1 ? { type: "LineString", coordinates: c } : null;
    }
    case "Track": {
      const c = kmlTrackCoords(el);
      return c.length > 1 ? { type: "LineString", coordinates: c } : null;
    }
    case "Polygon": {
      const outer = kmlCoords(child(child(el, "outerBoundaryIs") ?? el, "LinearRing"));
      if (outer.length < 3) return null;
      const inner = children(el, "innerBoundaryIs")
        .map((b) => kmlCoords(child(b, "LinearRing")))
        .filter((r) => r.length >= 3);
      return { type: "Polygon", coordinates: [outer, ...inner] };
    }
    case "MultiGeometry":
    case "MultiTrack": {
      const parts = Array.from(el.children)
        .map(kmlGeometry)
        .filter((g): g is Geometry => g !== null);
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : { type: "GeometryCollection", geometries: parts };
    }
    default:
      return null;
  }
}

const KML_GEOMETRY_TAGS = new Set([
  "Point",
  "LineString",
  "LinearRing",
  "Polygon",
  "MultiGeometry",
  "Track",
  "MultiTrack",
]);

/** Strip markup from a KML description (often HTML in a CDATA block). */
function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  if (!/[<&]/.test(html)) return html;
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
  return text || undefined;
}

function parseKmlDoc(doc: Document): { features: Feature[]; name?: string } {
  const docEl = descendants(doc, "Document")[0];
  const name = docEl ? childText(docEl, "name") : undefined;
  const features: Feature[] = [];

  for (const pm of descendants(doc, "Placemark")) {
    const geomEl = Array.from(pm.children).find((c) => KML_GEOMETRY_TAGS.has(c.localName));
    const geometry = geomEl ? kmlGeometry(geomEl) : null;
    if (!geometry) continue;
    const extended: Record<string, string | undefined> = {};
    for (const d of descendants(pm, "Data")) {
      const key = d.getAttribute("name");
      if (key) extended[key] = childText(d, "value");
    }
    for (const d of descendants(pm, "SimpleData")) {
      const key = d.getAttribute("name");
      if (key) extended[key] = d.textContent?.trim() || undefined;
    }
    features.push(
      feature(
        geometry,
        props({
          name: childText(pm, "name"),
          description: plainText(childText(pm, "description")),
          ...extended,
        }),
      ),
    );
  }
  return { features, name };
}

// --- Geometry checks -------------------------------------------------------

function positions(g: Geometry): Position[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "MultiPoint":
    case "LineString":
      return g.coordinates;
    case "MultiLineString":
    case "Polygon":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
    case "GeometryCollection":
      return g.geometries.flatMap(positions);
  }
}

function hasCoords(g: Geometry): boolean {
  try {
    return positions(g).length > 0;
  } catch {
    return false;
  }
}

function inLatLonRange(g: Geometry | null): boolean {
  if (!g) return true;
  return positions(g).every((p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Count features by broad geometry kind, for a one-line layer summary. */
export function summariseGeo(fc: FeatureCollection): string {
  const counts = { point: 0, line: 0, area: 0 };
  const tally = (g: Geometry) => {
    if (g.type === "Point" || g.type === "MultiPoint") counts.point++;
    else if (g.type === "LineString" || g.type === "MultiLineString") counts.line++;
    else if (g.type === "Polygon" || g.type === "MultiPolygon") counts.area++;
    else g.geometries.forEach(tally);
  };
  for (const f of fc.features) if (f.geometry) tally(f.geometry);
  const parts: string[] = [];
  if (counts.point) parts.push(plural(counts.point, "point"));
  if (counts.line) parts.push(plural(counts.line, "line"));
  if (counts.area) parts.push(plural(counts.area, "area"));
  return parts.join(", ");
}
