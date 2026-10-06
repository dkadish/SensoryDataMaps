// Styles for context geodata. Every format is normalised to the
// [simplestyle-spec](https://github.com/mapbox/simplestyle-spec) properties
// that GeoJSON editors (geojson.io, QGIS, togeojson) already write — `stroke`,
// `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`, `marker-color`,
// `marker-size` — so the map can draw each feature in its original colours and
// fall back to the layer's accent colour only where the file sets none.

import type { Feature, GeoJsonProperties } from "geojson";
import type { PathOptions } from "leaflet";

/** Property keys that describe a feature's look rather than its content; hidden
 *  from popups. */
export const STYLE_KEYS = new Set([
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill",
  "fill-opacity",
  "marker-color",
  "marker-size",
  "marker-symbol",
  "_umap_options",
  "style",
]);

/** Garmin GPX `DisplayColor` names. */
const GARMIN_COLORS: Record<string, string> = {
  black: "#000000",
  darkred: "#8b0000",
  darkgreen: "#006400",
  darkyellow: "#b5b500",
  darkblue: "#00008b",
  darkmagenta: "#8b008b",
  darkcyan: "#008b8b",
  lightgray: "#d3d3d3",
  darkgray: "#a9a9a9",
  red: "#ff0000",
  green: "#00ff00",
  yellow: "#ffff00",
  blue: "#0000ff",
  magenta: "#ff00ff",
  cyan: "#00ffff",
  white: "#ffffff",
};

export interface ParsedColor {
  color: string;
  opacity?: number;
}

/** KML colours are `aabbggrr` hex. */
export function parseKmlColor(text: string | undefined): ParsedColor | undefined {
  const hex = text?.trim().replace(/^#/, "");
  if (!hex || !/^[0-9a-f]{8}$/i.test(hex)) return undefined;
  const [a, b, g, r] = [0, 2, 4, 6].map((i) => hex.slice(i, i + 2));
  return { color: `#${r}${g}${b}`.toLowerCase(), opacity: parseInt(a, 16) / 255 };
}

/** GPX extension colours: `RRGGBB`, `#RRGGBB`, `#AARRGGBB` (OsmAnd) or a
 *  Garmin colour name. `Transparent` yields opacity 0. */
export function parseGpxColor(text: string | undefined): ParsedColor | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  const name = t.toLowerCase();
  if (name === "transparent") return { color: "#000000", opacity: 0 };
  if (GARMIN_COLORS[name]) return { color: GARMIN_COLORS[name] };
  const hex = t.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return { color: `#${hex}`.toLowerCase() };
  if (/^[0-9a-f]{8}$/i.test(hex)) {
    return { color: `#${hex.slice(2)}`.toLowerCase(), opacity: parseInt(hex.slice(0, 2), 16) / 255 };
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The style a feature's file gives it, from simplestyle properties plus two
 *  common alternatives: uMap's `_umap_options` and a Leaflet-style `style`
 *  object. Only what the file sets is returned. */
function fileStyle(p: GeoJsonProperties) {
  const props = p ?? {};
  const umap = obj(props._umap_options);
  const leaflet = obj(props.style);
  const pick = <T,>(...vals: (T | undefined)[]) => vals.find((v) => v !== undefined);
  return {
    stroke: pick(str(props.stroke), str(umap.color), str(leaflet.color)),
    strokeWidth: pick(num(props["stroke-width"]), num(umap.weight), num(leaflet.weight)),
    strokeOpacity: pick(num(props["stroke-opacity"]), num(umap.opacity), num(leaflet.opacity)),
    fill: pick(str(props.fill), str(umap.fillColor), str(leaflet.fillColor)),
    fillOpacity: pick(num(props["fill-opacity"]), num(umap.fillOpacity), num(leaflet.fillOpacity)),
    markerColor: pick(str(props["marker-color"]), str(umap.color), str(leaflet.color)),
    markerSize: str(props["marker-size"]),
  };
}

/** Default line width (px) of a context feature with no width of its own. */
export const CONTEXT_LINE_WIDTH = 3;

/** Leaflet path options for a context feature's lines and areas. `scale`
 *  multiplies every width, so the layer's width slider still thickens lines
 *  that carry their own width. An area with a stroke but no fill colour is
 *  filled in its stroke colour, as KML and simplestyle viewers do. */
export function contextPathStyle(f: Feature, accent: string, scale: number): PathOptions {
  const s = fileStyle(f.properties);
  const stroke = s.stroke ?? accent;
  return {
    color: stroke,
    weight: (s.strokeWidth ?? CONTEXT_LINE_WIDTH) * scale,
    opacity: s.strokeOpacity ?? 0.8,
    fillColor: s.fill ?? stroke,
    fillOpacity: s.fillOpacity ?? (s.fill ? 0.6 : 0.15),
  };
}

/** Circle-marker options for a context point: the file's marker colour (or
 *  stroke colour), else the accent. */
export function contextPointStyle(f: Feature, accent: string): PathOptions & { radius: number } {
  const s = fileStyle(f.properties);
  const radius = s.markerSize === "small" ? 4 : s.markerSize === "large" ? 7 : 5;
  return {
    radius,
    color: "#fff",
    weight: 1.5,
    fillColor: s.markerColor ?? accent,
    fillOpacity: 0.9,
  };
}
