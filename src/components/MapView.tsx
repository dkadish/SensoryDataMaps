import { useEffect } from "react";
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

interface MapViewProps {
  points: MapPoint[];
  polyline?: [number, number][];
  legend?: MapLegend;
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

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new LatLngBounds(points.map((p) => [p.lat, p.lon]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    }
  }, [map, points]);
  return null;
}

function LegendOverlay({ legend }: { legend: MapLegend }) {
  if (legend.kind === "gradient") {
    const { min, max, colors, label } = legend;
    const mid = (min + max) / 2;
    const gradient = `linear-gradient(to right, ${colors.join(", ")})`;
    return (
      <div className="map-legend">
        <div className="map-legend-title">{label}</div>
        <div className="map-legend-bar" style={{ background: gradient }} />
        <div className="map-legend-ticks">
          <span>{fmtNum(min)}</span>
          <span>{fmtNum(mid)}</span>
          <span>{fmtNum(max)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="map-legend">
      <div className="map-legend-title">{legend.label}</div>
      {legend.items.map((it) => (
        <div key={it.label} className="map-legend-item">
          <span className="swatch" style={{ background: it.color }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}

export default function MapView({ points, polyline, legend }: MapViewProps) {
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
        {polyline && polyline.length > 1 && (
          <Polyline positions={polyline} pathOptions={{ color: "#888", weight: 2, opacity: 0.7 }} />
        )}
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: "#222",
              weight: 1,
              fillColor: p.color,
              fillOpacity: 0.85,
            }}
          >
            {(p.label || p.rows) && (
              <Popup>
                <div className="popup">
                  {p.label && <strong>{p.label}</strong>}
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
        <FitBounds points={points} />
      </MapContainer>
      {legend && points.length > 0 && <LegendOverlay legend={legend} />}
    </div>
  );
}
