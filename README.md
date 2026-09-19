# Sensory Data Maps

A browser app for **rapidly mapping and analysing sensory data collected on
walks** — olfactory (electronic-nose) data and acoustic (audio) data — and
plotting it on an interactive map.

It runs entirely in the browser (no server, no data leaves your machine) and is
built to deploy as a static site to GitHub Pages, Netlify, or any static host.

## What it does

### Layers
- Add **multiple olfactory and/or acoustic tracks** and view them **together as
  layers** on one map. Each layer keeps its own controls (clustering, colouring,
  audio analysis, time-sync) and gets a distinct **accent colour** for its track
  line and marker outlines so overlapping walks stay legible.
- Toggle each layer's **visibility**, **rename** it, or **remove** it. Every
  visible layer contributes its points, its track line and its colour-scale
  legend, and the map fits to all of them at once.

### Olfactory
- Load a **BRIAN CSV** export (gas-sensor voltages + GPS; see
  [`docs/data-formats.md`](docs/data-formats.md)).
- **Hierarchical clustering** (Ward / complete / average / single linkage) over
  a selectable set of sensor channels, cut into *k* clusters with a slider.
- **Dendrogram** view, coloured to match the map.
- Map every sample, coloured by **cluster** or by any single **channel value**.

### Acoustic
- Load an **audio file**. Recordings that carry a **GPS track embedded in
  their metadata** (e.g. from the
  [GPS Audio Recorder](https://play.google.com/store/apps/details?id=com.gpsaudiorecorder)
  Android app) map on their own — no GPX required, and the recording start time
  is detected automatically. For any other audio, add a **GPX track** (e.g. a
  Strava export) as before.
- Compute **basic per-window acoustic metrics** in the browser (via
  [Meyda](https://meyda.js.org/)): RMS / level (dBFS), zero-crossing rate,
  spectral centroid, 85 % spectral rolloff, and spectral flatness.
- **Time-sync** the audio to the track (set the recording start time + a fine
  offset slider) so each window lands at the right place on the map.
- Map every window, coloured by any metric.

> **Ecoacoustic indices** (ACI, NDSI, ADI, AEI, BI, temporal/spectral entropy)
> are **not** computed yet. The analysis engine sits behind a small
> `AcousticAnalysisProvider` interface (`src/acoustic/provider.ts`) so a
> `scikit-maad`-parity engine — via Pyodide (WASM, still static) or a Python
> microservice — can be added later without touching the rest of the app. See
> the roadmap below.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run typecheck  # type-check only
```

### Try it with the sample data

`sample-data/` contains real walks you can load immediately:

- `smellwalk-2026-09-11.csv` — a 171-sample BRIAN smell walk (8 gas sensors +
  GPS). Add it with **+ Add olfactory layer**; clustering + dendrogram work out
  of the box.
- `kungsparken-sound-walk.gpx` — a Strava GPX sound-walk track (3,909 points).
  Add your own audio with **+ Add acoustic layer**, then upload this GPX inside
  the layer to see the route and place the computed metrics along it. Load both
  sample files to see the two walks overlaid as layers.

## Data formats

See [`docs/data-formats.md`](docs/data-formats.md). The olfactory CSV section
describes the **actual smell-walk export**; the parser also tolerates related
layouts and future columns (more sensors, environmental data) without changes.

## Deployment

The build uses **relative asset paths** (`base: "./"`), so `dist/` works on most
static hosts as-is. For a GitHub Pages **project** site served from
`https://<user>.github.io/SensoryDataMaps/`, build with an explicit base:

```bash
VITE_BASE=/SensoryDataMaps/ npm run build
```

A GitHub Actions workflow (`.github/workflows/deploy.yml`) does this
automatically and publishes to Pages on every push to the default branch — just
enable Pages → "GitHub Actions" in the repo settings.

## Tech stack

- **React + TypeScript + Vite**
- **Leaflet / react-leaflet** with OpenStreetMap tiles (no API key)
- **ml-hclust** for hierarchical clustering
- **Meyda** + Web Audio API for in-browser audio features
- **PapaParse** for CSV

## Roadmap

- [ ] Full ecoacoustic indices (Pyodide + `scikit-maad`, or a Python service).
- [ ] Olfactory GPS via separate GPX + time-sync (reuse the acoustic sync).
- [ ] Export: clustered CSV / GeoJSON download.
- [ ] Reconcile the CSV spec with the real BRIAN log export.
- [ ] Overlap / windowing options and spectrogram preview for audio.

## License

[MIT](LICENSE) © David Kadish

## Related projects

- [BrianHardware](https://github.com/ODRResearchGroup/BrianHardware) — the BRIAN
  e-nose firmware & hardware (source of olfactory data).
- [BrianReactNative](https://github.com/ODRResearchGroup/BrianReactNative),
  [BrianWeb](https://github.com/ODRResearchGroup/BrianWeb) — the existing BRIAN
  clients.
