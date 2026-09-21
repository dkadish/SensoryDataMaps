import { Fragment, memo, useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { LatLngBounds } from "leaflet";
import { categoricalColor } from "../lib/color";
import RadarChart, { type RadarAxis, type RadarSeries } from "./RadarChart";

export interface MapPoint {
  id: string | number;
  lat: number;
  lon: number;
  color: string;
  label?: string;
  rows?: [string, string][];
  /** Sortable position along the walk (e.g. timestamp or segment start), used to
   *  order points into a continuous streak. When absent for any point, the array
   *  order is used instead. */
  order?: number;
  /** Raw per-channel values for this sample, keyed by channel name. Present on
   *  olfactory samples; drives the fingerprint radar overlay when the point is
   *  selected. Points without it are not selectable. */
  fingerprint?: Record<string, number>;
}

/** A stable key identifying a selected point across layers. */
export function pointKey(layerId: string, id: string | number): string {
  return `${layerId}::${id}`;
}

/** A scale guide for how points are coloured. */
export type MapLegend =
  | { kind: "gradient"; label: string; min: number; max: number; colors: string[] }
  | { kind: "categorical"; label: string; items: { color: string; label: string }[] };

/** How a layer's samples are drawn on the map. `circles` is the classic marker
 *  per sample; `streak` connects the samples into one line whose colour changes
 *  along the walk (same per-sample colours as the circles); `both` overlays them. */
export type RenderMode = "circles" | "streak" | "both";

/** One data layer to draw on the map: its points, an optional track polyline and
 *  a colour-scale legend. `accent` is the layer's identity colour, used for the
 *  track line and the marker outline so overlapping layers stay distinguishable. */
export interface MapLayer {
  id: string;
  name: string;
  accent: string;
  points: MapPoint[];
  polyline?: [number, number][];
  legend?: MapLegend;
  /** Marker style; defaults to `circles`. */
  render?: RenderMode;
  /** Radar axes (channels + dataset-wide ranges) for this layer's fingerprints.
   *  Present on olfactory layers; enables the fingerprint overlay for its points. */
  fingerprintAxes?: RadarAxis[];
}

/** The live GPS position of an acoustic layer during audio playback. */
export interface PlayheadMarker {
  id: string;
  name: string;
  accent: string;
  lat: number;
  lon: number;
}

interface MapViewProps {
  layers: MapLayer[];
  /** Live playback positions, one per playing layer, drawn on top of everything. */
  playheads?: PlayheadMarker[];
  /** Keys (see `pointKey`) of points whose fingerprints are shown in the overlay. */
  selectedKeys?: string[];
  /** Toggle a point's membership in the fingerprint selection. */
  onToggleSelect?: (key: string) => void;
  /** Empty the fingerprint selection. */
  onClearSelection?: () => void;
}

/** Compact number formatting for legend ticks across very different ranges. */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v).toLocaleString();
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return "0";
  return v.toFixed(3);
}

/** Fit the view to every visible layer — its points and its track line. */
function FitBounds({ layers }: { layers: MapLayer[] }) {
  const map = useMap();
  // Fingerprint the drawn geometry so we only re-fit when it actually changes,
  // not on every parent re-render.
  const key = layers
    .map((l) => `${l.id}:${l.points.length}:${l.polyline?.length ?? 0}`)
    .join("|");
  useEffect(() => {
    const coords: [number, number][] = [];
    for (const l of layers) {
      for (const p of l.points) coords.push([p.lat, p.lon]);
      if (l.polyline) coords.push(...l.polyline);
    }
    if (coords.length === 0) return;
    const bounds = new LatLngBounds(coords);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** The details popup for a single sample, shared by circle markers and streak
 *  segments so a sample's readings are reachable in every render mode. */
function PointPopup({
  layerName,
  point,
  selected,
}: {
  layerName: string;
  point: MapPoint;
  selected?: boolean;
}) {
  if (!point.label && !point.rows) return null;
  return (
    <Popup>
      <div className="popup">
        <strong>{point.label ? `${layerName} · ${point.label}` : layerName}</strong>
        {point.fingerprint && (
          <p className="popup-hint">
            {selected
              ? "In fingerprint view — click again to remove."
              : "Click the marker to add its fingerprint to the radar view."}
          </p>
        )}
        {point.rows && (
          <table>
            <tbody>
              {point.rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="popup-key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Popup>
  );
}

/** Order a layer's points into walk sequence and pair each consecutive point
 *  into a coloured segment. Each segment takes the colour of the point it starts
 *  from, so the line's colour changes along the walk exactly as the circles do. */
function streakSegments(
  points: MapPoint[],
): { from: MapPoint; positions: [[number, number], [number, number]] }[] {
  const ordered = points.every((p) => Number.isFinite(p.order))
    ? [...points].sort((a, b) => (a.order as number) - (b.order as number))
    : points;
  const segs: { from: MapPoint; positions: [[number, number], [number, number]] }[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    segs.push({ from: a, positions: [[a.lat, a.lon], [b.lat, b.lon]] });
  }
  return segs;
}

function LegendBody({ legend }: { legend: MapLegend }) {
  if (legend.kind === "gradient") {
    const { min, max, colors, label } = legend;
    const mid = (min + max) / 2;
    const gradient = `linear-gradient(to right, ${colors.join(", ")})`;
    return (
      <>
        <div className="map-legend-title">{label}</div>
        <div className="map-legend-bar" style={{ background: gradient }} />
        <div className="map-legend-ticks">
          <span>{fmtNum(min)}</span>
          <span>{fmtNum(mid)}</span>
          <span>{fmtNum(max)}</span>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="map-legend-title">{legend.label}</div>
      {legend.items.map((it) => (
        <div key={it.label} className="map-legend-item">
          <span className="swatch" style={{ background: it.color }} />
          {it.label}
        </div>
      ))}
    </>
  );
}

/** Stacked legends — one block per visible layer that has a legend, headed by
 *  the layer name and its accent swatch so it is clear which layer it describes. */
function LegendStack({ layers }: { layers: MapLayer[] }) {
  const withLegend = layers.filter((l) => l.legend && l.points.length > 0);
  if (withLegend.length === 0) return null;
  return (
    <div className="map-legends">
      {withLegend.map((l) => (
        <div key={l.id} className="map-legend">
          <div className="map-legend-layer">
            <span className="swatch" style={{ background: l.accent }} />
            {l.name}
          </div>
          <LegendBody legend={l.legend!} />
        </div>
      ))}
    </div>
  );
}

/** All of a single layer's drawn geometry: its track line, streak and/or
 *  circle markers. Memoised so frequent playhead updates — which re-render
 *  MapView — don't churn every layer's markers, only the playhead itself. */
const LayerGraphics = memo(function LayerGraphics({
  layer,
  selectedColors,
  onToggleSelect,
}: {
  layer: MapLayer;
  /** key -> highlight colour for this layer's currently-selected points. */
  selectedColors: Map<string, string>;
  onToggleSelect?: (key: string) => void;
}) {
  const mode = layer.render ?? "circles";
  const showCircles = mode === "circles" || mode === "both";
  const showStreak = mode === "streak" || mode === "both";
  const selectable = !!(layer.fingerprintAxes && layer.fingerprintAxes.length > 0);
  return (
    <>
      {layer.polyline && layer.polyline.length > 1 && (
        <Polyline
          positions={layer.polyline}
          pathOptions={{ color: layer.accent, weight: 2, opacity: 0.7 }}
        />
      )}
      {showStreak &&
        streakSegments(layer.points).map((seg, i) => (
          <Polyline
            key={`${layer.id}:streak:${i}`}
            positions={seg.positions}
            pathOptions={{ color: seg.from.color, weight: 5, opacity: 0.9 }}
          >
            <PointPopup layerName={layer.name} point={seg.from} />
          </Polyline>
        ))}
      {showCircles &&
        layer.points.map((p) => {
          const canSelect = selectable && !!p.fingerprint;
          const sel = canSelect ? selectedColors.get(pointKey(layer.id, p.id)) : undefined;
          return (
            <CircleMarker
              key={`${layer.id}:${p.id}`}
              center={[p.lat, p.lon]}
              radius={sel ? 9 : 6}
              pathOptions={{
                color: sel ?? layer.accent,
                weight: sel ? 3.5 : 1.5,
                fillColor: p.color,
                fillOpacity: 0.85,
              }}
              eventHandlers={
                canSelect && onToggleSelect
                  ? { click: () => onToggleSelect(pointKey(layer.id, p.id)) }
                  : undefined
              }
            >
              <PointPopup layerName={layer.name} point={p} selected={!!sel} />
            </CircleMarker>
          );
        })}
    </>
  );
});

/** The moving "you are here" marker for a playing layer: a translucent halo
 *  behind a solid accent dot, so it stands out against the sample markers. */
function Playhead({ marker }: { marker: PlayheadMarker }) {
  return (
    <Fragment>
      <CircleMarker
        center={[marker.lat, marker.lon]}
        radius={15}
        pathOptions={{
          stroke: false,
          fillColor: marker.accent,
          fillOpacity: 0.22,
          interactive: false,
          className: "playhead-halo",
        }}
      />
      <CircleMarker
        center={[marker.lat, marker.lon]}
        radius={7}
        pathOptions={{
          color: "#ffffff",
          weight: 3,
          fillColor: marker.accent,
          fillOpacity: 1,
        }}
      >
        <Popup>
          <div className="popup">
            <strong>{marker.name} · playing</strong>
          </div>
        </Popup>
      </CircleMarker>
    </Fragment>
  );
}

/** Resolve selected point keys against the visible layers into radar series and
 *  a combined, de-duplicated axis set. A key that no longer resolves (its layer
 *  was hidden or removed) is skipped. Series colours are assigned by selection
 *  order so each selected marker and its polygon share a colour. */
function resolveSelection(
  layers: MapLayer[],
  selectedKeys: string[],
): { series: RadarSeries[]; axes: RadarAxis[]; colorByKey: Map<string, string> } {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const series: RadarSeries[] = [];
  const colorByKey = new Map<string, string>();
  const axisMap = new Map<string, RadarAxis>();

  for (const key of selectedKeys) {
    const sep = key.indexOf("::");
    if (sep < 0) continue;
    const layerId = key.slice(0, sep);
    const rest = key.slice(sep + 2);
    const layer = byId.get(layerId);
    if (!layer || !layer.fingerprintAxes) continue;
    const point = layer.points.find((p) => String(p.id) === rest);
    if (!point || !point.fingerprint) continue;

    const color = categoricalColor(series.length);
    colorByKey.set(key, color);
    series.push({
      id: key,
      label: point.label ? `${layer.name} · ${point.label}` : layer.name,
      color,
      values: point.fingerprint,
    });

    for (const ax of layer.fingerprintAxes) {
      const prev = axisMap.get(ax.key);
      if (prev) {
        // Same channel across layers: widen the range to cover both.
        axisMap.set(ax.key, {
          ...prev,
          min: Math.min(prev.min, ax.min),
          max: Math.max(prev.max, ax.max),
        });
      } else {
        axisMap.set(ax.key, { ...ax });
      }
    }
  }

  return { series, axes: [...axisMap.values()], colorByKey };
}

/** The floating fingerprint overlay: an overlaid radar chart of every selected
 *  sample's fingerprint, a colour legend with per-sample removal, and a control
 *  to clear the whole selection. */
function FingerprintPanel({
  series,
  axes,
  onRemove,
  onClear,
}: {
  series: RadarSeries[];
  axes: RadarAxis[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  if (series.length === 0) return null;
  return (
    <div className="fingerprint-panel">
      <div className="fingerprint-head">
        <span className="fingerprint-title">
          Fingerprints ({series.length})
        </span>
        <button type="button" className="fingerprint-clear" onClick={onClear}>
          Clear
        </button>
      </div>
      <RadarChart axes={axes} series={series} />
      <ul className="fingerprint-legend">
        {series.map((s) => (
          <li key={s.id}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="fingerprint-legend-label">{s.label}</span>
            <button
              type="button"
              className="fingerprint-remove"
              aria-label={`Remove ${s.label}`}
              title="Remove"
              onClick={() => onRemove(s.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MapView({
  layers,
  playheads,
  selectedKeys,
  onToggleSelect,
  onClearSelection,
}: MapViewProps) {
  const { series, axes, colorByKey } = useMemo(
    () => resolveSelection(layers, selectedKeys ?? []),
    [layers, selectedKeys],
  );
  return (
    <div className="mapwrap">
      <MapContainer
        center={[55.6, 13.0]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {layers.map((layer) => (
          <LayerGraphics
            key={layer.id}
            layer={layer}
            selectedColors={colorByKey}
            onToggleSelect={onToggleSelect}
          />
        ))}
        {playheads?.map((ph) => (
          <Playhead key={`playhead:${ph.id}`} marker={ph} />
        ))}
        <FitBounds layers={layers} />
      </MapContainer>
      <LegendStack layers={layers} />
      <FingerprintPanel
        series={series}
        axes={axes}
        onRemove={(key) => onToggleSelect?.(key)}
        onClear={() => onClearSelection?.()}
      />
    </div>
  );
}
