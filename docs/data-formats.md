# Data formats

Sensory Data Maps ingests three kinds of file. The olfactory CSV section below
describes the **actual smell-walk app export** (an example ships in
`sample-data/smellwalk-2026-09-11.csv`); the parser is deliberately tolerant so
it also accepts related layouts and future columns (more sensors, environmental
data) without code changes. See
[BrianHardware](https://github.com/ODRResearchGroup/BrianHardware) for the
sensor hardware.

---

## 1. Olfactory CSV (BRIAN smell-walk export)

A UTF-8 CSV with a **header row**, one row per sample. Column order does not
matter; columns are matched by name (case-insensitive, spaces/underscores
ignored). **Any unrecognised numeric column becomes a gas/feature channel** for
clustering — so new sensors (up to 11) appear automatically. Known metadata
columns are excluded from clustering.

### The current export

```csv
walk_id,recorded_at,latitude,longitude,accuracy_m,ch4,nh3,hcho,voc,odour,h2s,etoh,no2
walk-1789121628004,2026-09-11T10:13:58.076Z,55.6059751,12.9839043,3.46,0.894,0.576,0.028,0.450,3.244,0.026,0.014,0.156
```

### Recognised columns

| Purpose | Accepted header names (any of) | Units | Used for clustering? |
|---|---|---|---|
| Timestamp | `recorded_at`, `timestamp`, `time`, `datetime`, `date`, `ts` | ISO-8601 string, or Unix s/ms | no |
| Latitude | `latitude`, `lat` | decimal degrees (WGS84) | no |
| Longitude | `longitude`, `lon`, `lng`, `long` | decimal degrees (WGS84) | no |
| Walk id | `walk_id`, `walk`, `track_id`, `session[_id]` | string | no |
| GPS accuracy | `accuracy_m`, `accuracy`, `gps_accuracy`, `hacc` | m | no (metadata) |
| Temperature | `temperature`, `temperature_c`, `temp` | °C | no (env) |
| Pressure | `pressure`, `pressure_hpa`, `barometric_pressure` | hPa | no (env) |
| Humidity | `humidity`, `humidity_pct`, `rh` | % | no (env) |
| Gas resistance | `gas_resistance[_ohm]`, `voc_ohm` | Ω | no (env) |
| Air quality | `air_quality`, `aqi`, `iaq`, `air_quality_index` | index | no (env) |
| Altitude | `altitude`, `altitude_m`, `elevation` | m | no (env) |
| Other metadata | `id`, `index`, `seq`, `hdop`, `speed`, `heading`, `bearing`, `satellites`, … | — | no (ignored) |

### Gas / feature channels

Everything else numeric is a **feature channel** used for clustering. In the
current export these are the gas sensors (values in **volts**):

`ch4`, `nh3`, `hcho`, `voc`, `odour`, `h2s`, `etoh`, `no2`

Future exports may add more (up to 11): e.g. `co`, `smoke`, `h2`. They need no
code change — they'll simply appear as extra selectable channels. Channel names
are used verbatim, so `odour`/`Odor` etc. are whatever the header says.

### Notes

- Rows with a missing/invalid `latitude` **or** `longitude` are dropped (they
  can't be mapped). Rows with no timestamp are kept (timestamp becomes `NaN`;
  no walk path drawn).
- Missing individual sensor values are allowed; a channel is only offered for
  clustering when present on ≥ 50 % of samples.
- **Sensor-dropout rows** (e.g. all-zero readings from a momentary glitch) are
  kept as-is and typically surface as a singleton outlier cluster — a useful
  QC signal, but consider filtering them before drawing conclusions.
- **Multiple `walk_id`s** in one file are currently shown together (per-walk
  split is on the roadmap).
- Environmental columns are parsed into each sample and shown in its map popup,
  but are **not** clustering inputs by default (see the README roadmap for
  making them opt-in).

---

## 2. GPX track (for acoustic data)

A standard [GPX 1.1](https://www.topografix.com/gpx.asp) file, such as a Strava
export. Only track points are read:

```xml
<trkpt lat="55.6050" lon="13.0038">
  <ele>12.3</ele>
  <time>2026-09-25T10:00:00Z</time>
</trkpt>
```

- `lat`, `lon` attributes are required on each `<trkpt>`.
- `<time>` is required for time-based sync with audio. Points are sorted by time.
- `<ele>` (elevation, m) is optional.
- Waypoints (`<wpt>`) and routes (`<rte>`) are ignored for now.

---

## 3. Audio file

Any format the browser's Web Audio API can decode — in practice **WAV, FLAC,
MP3, M4A/AAC, OGG** (support varies slightly by browser; WAV and MP3 are safe).

Audio carries **no reliable absolute start time**, so the app needs one of:

1. A **start date-time** you enter for the recording, or
2. "Align audio start to the first GPX point" (assumes you started the recorder
   and the track together), plus
3. A fine **offset (seconds)** slider to nudge the alignment.

Each analysis window's location is found by linearly interpolating the GPX track
at `audioStart + windowTime`. Windows outside the track's time range are left
un-located (and not mapped).

---

## Roadmap / open questions

- Confirm the real BRIAN log export and align the CSV spec with it.
- Decide whether olfactory GPS will be embedded in the CSV or supplied as a
  separate GPX to be time-synced (same mechanism as audio).
- Full ecoacoustic indices (ACI, NDSI, ADI, AEI, BI, Ht, Hf) are **not** yet
  computed — only basic per-window metrics. See the `AcousticAnalysisProvider`
  interface for where a `scikit-maad`-parity engine (Pyodide or a Python
  service) would plug in.
