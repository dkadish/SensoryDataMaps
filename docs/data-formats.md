# Data formats

Sensory Data Maps ingests three kinds of file. None of these formats are frozen
yet — the olfactory CSV in particular is **proposed here** because
[BrianHardware](https://github.com/ODRResearchGroup/BrianHardware) currently
streams data over BLE rather than exporting a file. When BRIAN gains a logging
export, this document should be reconciled with it (and vice-versa). The parser
is deliberately tolerant so it can adapt as the real format settles.

---

## 1. Olfactory CSV (BRIAN)

A UTF-8 CSV with a **header row**. One row per sample. Column order does not
matter; columns are matched by name (case-insensitive, spaces/underscores
ignored). Unknown numeric columns are treated as extra feature channels, so the
file stays forward-compatible with new sensors.

### Recognised columns

| Purpose | Accepted header names (any of) | Units |
|---|---|---|
| Timestamp | `timestamp`, `time`, `datetime`, `iso_time` | ISO-8601 string, or Unix seconds/milliseconds |
| Latitude | `lat`, `latitude` | decimal degrees (WGS84) |
| Longitude | `lon`, `lng`, `long`, `longitude` | decimal degrees (WGS84) |
| Temperature | `temperature`, `temperature_c`, `temp` | °C |
| Pressure | `pressure`, `pressure_hpa` | hPa |
| Humidity | `humidity`, `humidity_pct`, `rh` | % |
| Gas resistance | `gas_resistance`, `gas_resistance_ohm`, `voc_ohm` | Ω |
| Altitude | `altitude`, `altitude_m`, `elevation` | m |

### Gas / feature channels

Every remaining numeric column becomes a **feature channel** used for
clustering. To match the BRIAN V1 hardware, the recommended channel headers are
the canonical sensor names (values in **volts**):

`HCHO`, `CH4`, `VOC`, `Odor`, `EtOH`, `H2S`, `NO2`, `NH3`, `CO`, `Smoke`, `H2`

(See the BrianHardware `CLAUDE.md` BLE contract table for the authoritative
sensor list and which ADS1115 channel each lives on.)

### Example

```csv
timestamp,lat,lon,HCHO,CH4,VOC,Odor,EtOH,H2S,NO2,NH3,CO,Smoke,H2,temperature_c,humidity_pct,pressure_hpa,gas_resistance_ohm
2026-09-25T10:00:00Z,55.6050,13.0038,0.412,0.900,1.230,0.330,0.780,0.150,0.220,0.410,0.560,0.190,0.640,19.4,58.2,1012.7,45210
2026-09-25T10:00:05Z,55.6051,13.0040,0.418,0.905,1.240,0.335,0.790,0.152,0.223,0.415,0.561,0.191,0.642,19.4,58.1,1012.7,45120
```

### Notes

- Rows with a missing/invalid `lat` **or** `lon` are dropped (they can't be
  mapped). Rows with a missing timestamp are kept (timestamp becomes `NaN`).
- Missing individual sensor values are allowed; a channel is only offered for
  clustering when it is present on enough samples.
- If your export puts GPS on a separate device, pre-join it to the sensor rows
  by timestamp before uploading, or use the acoustic-style GPX sync (not yet
  wired for olfactory — see the roadmap in the README).

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
