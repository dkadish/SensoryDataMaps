# Base maps

> **Status: planned.** The app currently shows only the OpenStreetMap base map.
> This document records the decision and the spec for adding a satellite
> option. Tracked in [#14](https://github.com/dkadish/SensoryDataMaps/issues/14).

## Decision

- **Keep Leaflet / react-leaflet** as the map library. A 2D map is enough for
  reading sensory samples against their surroundings, and the app stays static
  with no API key.
- **Add Esri World Imagery** as a satellite base map alongside the existing
  OpenStreetMap ("normal") base map.
- Alternatives considered and not chosen for now:
  - **MapLibre GL JS:** adds 3D buildings, terrain and tilt, but would mean
    rewriting the map view.
  - **Google Photorealistic 3D / 3D Maps:** needs a paid API key, and EEA
    billing accounts can't use Map Tiles API 3D tiles in third-party renderers.
    It also locks the project into Google's renderer.
  - **Lantmäteriet orthophotos:** high resolution for Sweden, but the main
    viewing service needs a licence. It could be revisited as an extra
    Sweden-only option.

## Spec

### Base maps offered

| Name in UI | Source | Tile URL | Attribution | Max native zoom |
|---|---|---|---|---|
| **Map** (default) | OpenStreetMap | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors` | 19 |
| **Satellite** | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | `Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community` | 19 |

Note the Esri URL's tile order: it is `{z}/{y}/{x}`, not `{z}/{x}/{y}`.

### Behaviour

- The user can switch between **Map** and **Satellite** at any time. Only one
  base map is shown at once.
- **Map** is the default on first load.
- The choice is remembered between visits on the same browser, where browser
  storage is available. If it isn't, the app falls back to **Map**.
- Switching the base map does not change the view: zoom, centre, and every
  sensory and context layer (visibility, styling, legends) stay as they were.
- Sensory and context layers keep drawing above the base map in both modes.
  Track lines, markers and context features should stay legible on imagery.
  Darker satellite imagery may need marker outlines or track-line halos for
  contrast.
- The attribution shown always matches the active base map.
- Zooming past the imagery's native resolution should upscale the last
  available tiles rather than show "Map data not yet available" tiles.

### Out of scope

- Place-name labels over satellite imagery (Esri's reference/labels overlay).
  This can be added later as an optional "Satellite + labels" mode.
- Other base maps (for example Lantmäteriet, OpenTopoMap or a dark style).
  These should be easy to add later by extending the table above.
- 3D buildings or terrain.

## Terms of use

Esri requires attribution in every application that uses its services. The
free use granted for OpenStreetMap editing does not cover other applications,
so any other use of World Imagery falls under Esri's terms of use. This is
fine for research and prototype use. Before wider or commercial deployment,
check whether an ArcGIS Location Platform account (API key) is needed.
