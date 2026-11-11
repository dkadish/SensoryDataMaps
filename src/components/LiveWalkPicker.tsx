import { useState } from "react";
import {
  defaultBackendUrl,
  fetchLiveWalks,
  normaliseBackendUrl,
  rememberBackendUrl,
  type LiveWalk,
} from "../live/brianBackend";

/** A walk counts as "live" if it sent data this recently (the app flushes every 5 s). */
export const LIVE_THRESHOLD_MS = 60_000;

const WINDOWS: { hours: number; label: string }[] = [
  { hours: 6, label: "6 h" },
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];

interface Props {
  /** Already-added live walks, by walk id, so they can't be added twice. */
  addedWalkIds: string[];
  onAdd: (backendUrl: string, walk: LiveWalk) => void;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Connect to BrianBackend and pick a recent or in-progress walk to stream. */
export default function LiveWalkPicker({ addedWalkIds, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(defaultBackendUrl);
  const [hours, setHours] = useState(24);
  const [walks, setWalks] = useState<LiveWalk[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);

  const load = async () => {
    const base = normaliseBackendUrl(url);
    if (!base) {
      setError("Enter the BrianBackend URL.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLiveWalks(base, hours);
      rememberBackendUrl(base);
      setWalks(result);
      setCheckedAt(Date.now());
    } catch (e) {
      setWalks(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="filebtn" onClick={() => setOpen(true)}>
        + Add live walk (BRIAN backend)
      </button>
    );
  }

  return (
    <div className="live-picker">
      <div className="live-picker-head">
        <strong>Live walks</strong>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <form
        className="live-picker-form"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label className="small">
          Backend URL
          <input
            type="url"
            placeholder="https://brian-backend.example.app"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="live-picker-row">
          <label className="small">
            Active in the last
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "Loading…" : walks ? "Refresh" : "Find walks"}
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {walks && walks.length === 0 && (
        <p className="muted small">No walks with data in this period.</p>
      )}
      {walks && walks.length > 0 && (
        <ul className="live-walks">
          {walks.map((w) => {
            const live = checkedAt - w.lastAt < LIVE_THRESHOLD_MS;
            const added = addedWalkIds.includes(w.walkId);
            return (
              <li key={w.walkId}>
                <div className="live-walk-text">
                  <span className="live-walk-id" title={w.walkId}>
                    {live && <span className="live-dot" aria-label="Recording now" />}
                    {w.deviceName ?? "Unknown device"}
                  </span>
                  <span className="muted small">
                    {new Date(w.firstAt).toLocaleString()} ·{" "}
                    {live ? "recording now" : `last data ${ago(checkedAt - w.lastAt)}`} ·{" "}
                    {w.sensors.length} sensors
                  </span>
                </div>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onAdd(normaliseBackendUrl(url), w)}
                >
                  {added ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
