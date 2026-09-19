import { useCallback, useState } from "react";
import MapView, { type MapLegend, type MapPoint } from "./components/MapView";
import OlfactoryPanel from "./components/OlfactoryPanel";
import AcousticPanel from "./components/AcousticPanel";
import { parseBrianCsv } from "./olfactory/parseBrianCsv";
import { readTextFile } from "./lib/readFile";
import type { OlfactoryDataset } from "./types";

type Mode = "olfactory" | "acoustic";

export default function App() {
  const [mode, setMode] = useState<Mode>("olfactory");
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [polyline, setPolyline] = useState<[number, number][] | undefined>();
  const [legend, setLegend] = useState<MapLegend | undefined>();

  // Olfactory input
  const [dataset, setDataset] = useState<OlfactoryDataset | null>(null);
  const [olfInfo, setOlfInfo] = useState<string | null>(null);
  const [olfError, setOlfError] = useState<string | null>(null);

  // Acoustic input
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [gpxText, setGpxText] = useState<{ text: string; name: string } | null>(null);

  const onMapData = useCallback(
    (p: MapPoint[], line?: [number, number][], lgnd?: MapLegend) => {
      setPoints(p);
      setPolyline(line);
      setLegend(lgnd);
    },
    [],
  );

  const switchMode = (m: Mode) => {
    setMode(m);
    setPoints([]);
    setPolyline(undefined);
    setLegend(undefined);
  };

  const handleCsv = async (file: File) => {
    setOlfError(null);
    setOlfInfo(null);
    try {
      const text = await readTextFile(file);
      const result = parseBrianCsv(text, file.name);
      setDataset(result.dataset);
      const bits = [`Loaded ${result.dataset.samples.length} samples`];
      if (result.droppedRows) bits.push(`${result.droppedRows} rows dropped (no lat/lon)`);
      if (result.warnings.length) bits.push(...result.warnings);
      setOlfInfo(bits.join(" · "));
    } catch (e) {
      setDataset(null);
      setOlfError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleGpx = async (file: File) => {
    const text = await readTextFile(file);
    setGpxText({ text, name: file.name });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>Sensory Data Maps</h1>
          <p className="tagline">Map & analyse olfactory and acoustic walks</p>
        </header>

        <div className="tabs">
          <button
            className={mode === "olfactory" ? "tab active" : "tab"}
            onClick={() => switchMode("olfactory")}
          >
            Olfactory
          </button>
          <button
            className={mode === "acoustic" ? "tab active" : "tab"}
            onClick={() => switchMode("acoustic")}
          >
            Acoustic
          </button>
        </div>

        {mode === "olfactory" && (
          <>
            <section className="upload">
              <label className="filebtn">
                Upload BRIAN CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])}
                />
              </label>
              {olfInfo && <p className="muted small">{olfInfo}</p>}
              {olfError && <p className="error">{olfError}</p>}
            </section>
            {dataset ? (
              <OlfactoryPanel dataset={dataset} onMapData={onMapData} />
            ) : (
              <p className="muted">
                Upload a CSV to begin. See <code>docs/data-formats.md</code> for the format.
              </p>
            )}
          </>
        )}

        {mode === "acoustic" && (
          <>
            <section className="upload">
              <label className="filebtn">
                {audioFile ? `Audio: ${audioFile.name}` : "Upload audio file"}
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])}
                />
              </label>
              <label className="filebtn">
                {gpxText ? `GPX: ${gpxText.name}` : "Upload GPX track (optional)"}
                <input
                  type="file"
                  accept=".gpx,application/gpx+xml,text/xml"
                  onChange={(e) => e.target.files?.[0] && handleGpx(e.target.files[0])}
                />
              </label>
            </section>
            <AcousticPanel audioFile={audioFile} gpxText={gpxText} onMapData={onMapData} />
          </>
        )}

        <footer className="foot">
          <a href="https://github.com/dkadish/SensoryDataMaps">Source & docs</a>
        </footer>
      </aside>

      <main className="map-pane">
        <MapView points={points} polyline={polyline} legend={legend} />
        {points.length === 0 && (
          <div className="map-hint">Load data to plot it here.</div>
        )}
      </main>
    </div>
  );
}
