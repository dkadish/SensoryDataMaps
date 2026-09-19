import { Fragment, useEffect } from "react";
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
}

/** A scale guide for how points are coloured. */
export type MapLegend =
  | { kind: "gradient"; label: string; min: number; max: number; colors: string[] }
  | { kind: "categorical"; label: string; items: { color: string; label: string }[] };

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
}

interface MapViewProps {
  layers: MapLayer[];
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

export default function MapView({ layers }: MapViewProps) {
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
          <Fragment key={layer.id}>
            {layer.polyline && layer.polyline.length > 1 && (
              <Polyline
                positions={layer.polyline}
                pathOptions={{ color: layer.accent, weight: 2, opacity: 0.7 }}
              />
            )}
            {layer.points.map((p) => (
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
                {(p.label || p.rows) && (
                  <Popup>
                    <div className="popup">
                      <strong>{p.label ? `${layer.name} · ${p.label}` : layer.name}</strong>
                      {p.rows && (
                        <table>
                          <tbody>
                            {p.rows.map(([k, v]) => (
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
                )}
              </CircleMarker>
            ))}
          </Fragment>
        ))}
        <FitBounds layers={layers} />
      </MapContainer>
      <LegendStack layers={layers} />
    </div>
  );
}
