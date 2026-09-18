import { useEffect, useMemo, useState } from "react";
import type { OlfactoryDataset } from "../types";
import {
  buildOlfactoryTree,
  cutTree,
  LINKAGE_METHODS,
  type LinkageMethod,
} from "../olfactory/clustering";
import { categoricalColor, sequentialColor } from "../lib/color";
import { extent } from "../lib/stats";
import type { MapPoint } from "./MapView";
import Dendrogram from "./Dendrogram";

interface Props {
  dataset: OlfactoryDataset;
  onMapData: (points: MapPoint[], polyline?: [number, number][]) => void;
}

const CLUSTER_MODE = "__cluster__";

function fmtTime(t: number): string {
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "—";
}

export default function OlfactoryPanel({ dataset, onMapData }: Props) {
  const allChannels = dataset.featureChannels;
  const [selected, setSelected] = useState<string[]>(allChannels);
  const [method, setMethod] = useState<LinkageMethod>("ward");
  const [k, setK] = useState(Math.min(4, dataset.samples.length));
  const [colorMode, setColorMode] = useState<string>(CLUSTER_MODE);
  const [error, setError] = useState<string | null>(null);

  // Reset controls when a new dataset is loaded.
  useEffect(() => {
    setSelected(dataset.featureChannels);
    setK(Math.min(4, dataset.samples.length));
    setColorMode(CLUSTER_MODE);
  }, [dataset]);

  const built = useMemo(() => {
    setError(null);
    if (selected.length === 0) return null;
    try {
      return buildOlfactoryTree(dataset, selected, method);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [dataset, selected, method]);

  const assignments = useMemo(
    () => (built ? cutTree(built.tree, k, built.n) : null),
    [built, k],
  );

  // Build map points + track polyline and hand them up to the app.
  useEffect(() => {
    const samples = dataset.samples;
    let channelExtent: [number, number] = [NaN, NaN];
    if (colorMode !== CLUSTER_MODE) {
      channelExtent = extent(samples.map((s) => s.features[colorMode]));
    }
    const [lo, hi] = channelExtent;
    const span = hi - lo || 1;

    const points: MapPoint[] = samples.map((s, i) => {
      let color = "#0072B2";
      if (colorMode === CLUSTER_MODE && assignments) {
        color = categoricalColor(assignments[i]);
      } else if (colorMode !== CLUSTER_MODE) {
        const v = s.features[colorMode];
        color = Number.isFinite(v) ? sequentialColor((v - lo) / span) : "#ccc";
      }
      const rows: [string, string][] = [["Time", fmtTime(s.timestamp)]];
      if (assignments) rows.push(["Cluster", String(assignments[i] + 1)]);
      for (const c of selected) {
        const v = s.features[c];
        if (Number.isFinite(v)) rows.push([c, v.toFixed(3)]);
      }
      return { id: i, lat: s.lat, lon: s.lon, color, label: `Sample ${i + 1}`, rows };
    });

    // Draw the walk path if timestamps let us order the samples.
    const timed = samples
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => Number.isFinite(s.timestamp))
      .sort((a, b) => a.s.timestamp - b.s.timestamp);
    const polyline: [number, number][] | undefined =
      timed.length > 1 ? timed.map(({ s }) => [s.lat, s.lon]) : undefined;

    onMapData(points, polyline);
  }, [dataset, assignments, selected, colorMode, onMapData]);

  const toggleChannel = (c: string) => {
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const clusterSizes = useMemo(() => {
    if (!assignments) return [];
    const counts = new Map<number, number>();
    for (const a of assignments) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [assignments]);

  return (
    <div className="panel-body">
      <p className="muted">
        {dataset.samples.length.toLocaleString()} samples · {allChannels.length} channels
      </p>

      <section>
        <h3>Channels for clustering</h3>
        <div className="chips">
          {allChannels.map((c) => (
            <label key={c} className={`chip ${selected.includes(c) ? "on" : ""}`}>
              <input
                type="checkbox"
                checked={selected.includes(c)}
                onChange={() => toggleChannel(c)}
              />
              {c}
            </label>
          ))}
          {allChannels.length === 0 && (
            <span className="muted">No numeric channels detected in this file.</span>
          )}
        </div>
      </section>

      <section>
        <h3>Hierarchical clustering</h3>
        <label className="field">
          Linkage
          <select value={method} onChange={(e) => setMethod(e.target.value as LinkageMethod)}>
            {LINKAGE_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Clusters (k): <strong>{k}</strong>
          <input
            type="range"
            min={1}
            max={Math.min(12, dataset.samples.length)}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          />
        </label>
        {error && <p className="error">{error}</p>}
        {clusterSizes.length > 0 && (
          <div className="legend">
            {clusterSizes.map(([id, count]) => (
              <span key={id} className="legend-item">
                <span className="swatch" style={{ background: categoricalColor(id) }} />
                Cluster {id + 1} ({count})
              </span>
            ))}
          </div>
        )}
      </section>

      {built && assignments && (
        <section>
          <h3>Dendrogram</h3>
          <Dendrogram tree={built.tree} assignments={assignments} />
        </section>
      )}

      <section>
        <h3>Map colour</h3>
        <label className="field">
          Colour points by
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value)}>
            <option value={CLUSTER_MODE}>Cluster</option>
            {allChannels.map((c) => (
              <option key={c} value={c}>
                {c} (value)
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}
