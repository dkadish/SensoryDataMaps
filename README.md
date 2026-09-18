# Sensory Data Maps

A browser app for **rapidly mapping and analysing sensory data collected on
walks** — olfactory (electronic-nose) data and acoustic (audio) data — and
plotting it on an interactive map.

It runs entirely in the browser (no server, no data leaves your machine) and is
built to deploy as a static site to GitHub Pages, Netlify, or any static host.

## What it does

### Olfactory
- Load a **BRIAN CSV** export (gas-sensor voltages + GPS; see
  [`docs/data-formats.md`](docs/data-formats.md)).
- **Hierarchical clustering** (Ward / complete / average / single linkage) over
  a selectable set of sensor channels, cut into *k* clusters with a slider.
- **Dendrogram** view, coloured to match the map.
- Map every sample, coloured by **cluster** or by any single **channel value**.

### Acoustic
- Load an **audio file** + a **GPX track** (e.g. a Strava export).
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

`sample-data/` contains a synthetic walk you can load immediately:

- `example-olfactory-walk.csv` — 60 samples through three "smell zones"
  (clean → traffic → bakery); clustering separates them cleanly.
- `example-track.gpx` — a 5-minute GPX track for testing the acoustic sync
  (bring your own audio file recorded over the same period).

## Data formats

See [`docs/data-formats.md`](docs/data-formats.md). The BRIAN olfactory CSV is
**proposed here** — BrianHardware currently streams over BLE and has no file
export yet, so this spec should be reconciled with the firmware when it gains
one.

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

## Related projects

- [BrianHardware](https://github.com/ODRResearchGroup/BrianHardware) — the BRIAN
  e-nose firmware & hardware (source of olfactory data).
- [BrianReactNative](https://github.com/ODRResearchGroup/BrianReactNative),
  [BrianWeb](https://github.com/ODRResearchGroup/BrianWeb) — the existing BRIAN
  clients.
