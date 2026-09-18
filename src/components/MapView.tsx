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

interface MapViewProps {
  points: MapPoint[];
  polyline?: [number, number][];
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

export default function MapView({ points, polyline }: MapViewProps) {
  return (
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
  );
}
