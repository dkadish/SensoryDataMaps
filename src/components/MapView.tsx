import { Fragment, memo, useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { LatLngBounds } from "leaflet";

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
function PointPopup({ layerName, point }: { layerName: string; point: MapPoint }) {
  if (!point.label && !point.rows) return null;
  return (
    <Popup>
      <div className="popup">
        <strong>{point.label ? `${layerName} · ${point.label}` : layerName}</strong>
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
const LayerGraphics = memo(function LayerGraphics({ layer }: { layer: MapLayer }) {
  const mode = layer.render ?? "circles";
  const showCircles = mode === "circles" || mode === "both";
  const showStreak = mode === "streak" || mode === "both";
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
        layer.points.map((p) => (
          <CircleMarker
            key={`${layer.id}:${p.id}`}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: layer.accent,
              weight: 1.5,
              fillColor: p.color,
              fillOpacity: 0.85,
            }}
          >
            <PointPopup layerName={layer.name} point={p} />
          </CircleMarker>
        ))}
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

export default function MapView({ layers, playheads }: MapViewProps) {
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
          <LayerGraphics key={layer.id} layer={layer} />
        ))}
        {playheads?.map((ph) => (
          <Playhead key={`playhead:${ph.id}`} marker={ph} />
        ))}
        <FitBounds layers={layers} />
      </MapContainer>
      <LegendStack layers={layers} />
    </div>
  );
}
