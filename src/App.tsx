import { useCallback, useMemo, useRef, useState } from "react";
import MapView, {
  type MapLayer,
  type MapLegend,
  type MapPoint,
  type RenderMode,
} from "./components/MapView";
import OlfactoryPanel from "./components/OlfactoryPanel";
import AcousticPanel from "./components/AcousticPanel";
import LayerCard from "./components/LayerCard";
import { parseBrianCsv } from "./olfactory/parseBrianCsv";
import { readTextFile } from "./lib/readFile";
import { categoricalColor } from "./lib/color";
import type { OlfactoryDataset } from "./types";

/** The map output a layer's panel produces, keyed by layer id in App state. */
interface LayerOutput {
  points: MapPoint[];
  polyline?: [number, number][];
  legend?: MapLegend;
}

interface BaseLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Identity colour — the layer's track line and marker outline on the map. */
  accent: string;
  /** How this layer draws its samples: circles, a colour-changing streak, or both. */
  render: RenderMode;
}

interface OlfactoryLayer extends BaseLayer {
  kind: "olfactory";
  dataset: OlfactoryDataset;
  info: string;
}

interface AcousticLayer extends BaseLayer {
  kind: "acoustic";
  audioFile: File;
  gpxText: { text: string; name: string } | null;
}

type Layer = OlfactoryLayer | AcousticLayer;

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [outputs, setOutputs] = useState<Record<string, LayerOutput>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const seq = useRef(0);

  // Each layer's map output is reported here, keyed by id, and merged into the
  // combined map. A stable identity keeps the panels' effects from re-firing.
  const onLayerData = useCallback(
    (id: string, points: MapPoint[], polyline?: [number, number][], legend?: MapLegend) => {
      setOutputs((prev) => ({ ...prev, [id]: { points, polyline, legend } }));
    },
    [],
  );

  const nextLayerBase = () => {
    const n = seq.current++;
    return { id: `layer-${n}`, accent: categoricalColor(n) };
  };

  const handleAddCsv = async (file: File) => {
    setAddError(null);
    try {
      const text = await readTextFile(file);
      const result = parseBrianCsv(text, file.name);
      const bits = [`Loaded ${result.dataset.samples.length} samples`];
      if (result.droppedRows) bits.push(`${result.droppedRows} rows dropped (no lat/lon)`);
      if (result.warnings.length) bits.push(...result.warnings);
      const { id, accent } = nextLayerBase();
      setLayers((prev) => [
        ...prev,
        {
          id,
          kind: "olfactory",
          name: file.name,
          visible: true,
          accent,
          render: "circles",
          dataset: result.dataset,
          info: bits.join(" · "),
        },
      ]);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAddAudio = (file: File) => {
    setAddError(null);
    const { id, accent } = nextLayerBase();
    setLayers((prev) => [
      ...prev,
      {
        id,
        kind: "acoustic",
        name: file.name,
        visible: true,
        accent,
        render: "circles",
        audioFile: file,
        gpxText: null,
      },
    ]);
  };

  const handleAddGpx = async (id: string, file: File) => {
    try {
      const text = await readTextFile(file);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === id && l.kind === "acoustic" ? { ...l, gpxText: { text, name: file.name } } : l,
        ),
      );
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleVisible = (id: string) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));

  const renameLayer = (id: string, name: string) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));

  const setRenderMode = (id: string, render: RenderMode) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, render } : l)));

  const removeLayer = (id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setOutputs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // Combine visible layers' outputs for the map.
  const mapLayers = useMemo<MapLayer[]>(
    () =>
      layers
        .filter((l) => l.visible)
        .map((l) => {
          const o = outputs[l.id];
          return {
            id: l.id,
            name: l.name,
            accent: l.accent,
            render: l.render,
            points: o?.points ?? [],
            polyline: o?.polyline,
            legend: o?.legend,
          };
        }),
    [layers, outputs],
  );

  const totalPoints = mapLayers.reduce((n, l) => n + l.points.length, 0);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>Sensory Data Maps</h1>
          <p className="tagline">Map & analyse olfactory and acoustic walks — as layers</p>
        </header>

        <section className="upload">
          <label className="filebtn">
            + Add olfactory layer (BRIAN CSV)
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                if (e.target.files?.[0]) handleAddCsv(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="filebtn">
            + Add acoustic layer (audio)
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                if (e.target.files?.[0]) handleAddAudio(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          {addError && <p className="error">{addError}</p>}
        </section>

        {layers.length === 0 && (
          <p className="muted">
            Add one or more olfactory and/or acoustic layers to map them together.
            See <code>docs/data-formats.md</code> for the formats.
          </p>
        )}

        <div className="layers">
          {layers.map((layer) => (
            <LayerCard
              key={layer.id}
              name={layer.name}
              kindLabel={layer.kind === "olfactory" ? "Olfactory" : "Acoustic"}
              accent={layer.accent}
              visible={layer.visible}
              renderMode={layer.render}
              pointCount={outputs[layer.id]?.points.length ?? 0}
              onToggleVisible={() => toggleVisible(layer.id)}
              onRemove={() => removeLayer(layer.id)}
              onRename={(name) => renameLayer(layer.id, name)}
              onRenderModeChange={(mode) => setRenderMode(layer.id, mode)}
            >
              {layer.kind === "olfactory" ? (
                <>
                  {layer.info && <p className="muted small">{layer.info}</p>}
                  <OlfactoryPanel
                    layerId={layer.id}
                    dataset={layer.dataset}
                    onLayerData={onLayerData}
                  />
                </>
              ) : (
                <>
                  <label className="filebtn small">
                    {layer.gpxText ? `GPX: ${layer.gpxText.name}` : "Upload GPX track (optional)"}
                    <input
                      type="file"
                      accept=".gpx,application/gpx+xml,text/xml"
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleAddGpx(layer.id, e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <AcousticPanel
                    layerId={layer.id}
                    audioFile={layer.audioFile}
                    gpxText={layer.gpxText}
                    onLayerData={onLayerData}
                  />
                </>
              )}
            </LayerCard>
          ))}
        </div>

        <footer className="foot">
          <a href="https://github.com/dkadish/SensoryDataMaps">Source & docs</a>
        </footer>
      </aside>

      <main className="map-pane">
        <MapView layers={mapLayers} />
        {totalPoints === 0 && (
          <div className="map-hint">
            {layers.length === 0 ? "Add a layer to plot it here." : "Configure a layer to plot it here."}
          </div>
        )}
      </main>
    </div>
  );
}
