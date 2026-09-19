import { useCallback, useEffect, useMemo, useState } from "react";
import type { AcousticSegment, GpxTrack } from "../types";
import { decodeAudioFile, type DecodedAudio } from "../acoustic/audio";
import { parseGpx, trackTimeRange } from "../acoustic/gpx";
import { extractEmbeddedTrack, type EmbeddedTrackResult } from "../acoustic/embeddedTrack";
import { locateSegments } from "../acoustic/sync";
import { meydaProvider, METRIC_LABELS } from "../acoustic/meydaProvider";
import { DEFAULT_ANALYSIS_OPTIONS } from "../acoustic/provider";
import { sequentialColor, sequentialSwatches } from "../lib/color";
import { extent } from "../lib/stats";
import type { MapLegend, MapPoint } from "./MapView";

interface Props {
  layerId: string;
  audioFile: File | null;
  gpxText: { text: string; name: string } | null;
  onLayerData: (
    layerId: string,
    points: MapPoint[],
    polyline?: [number, number][],
    legend?: MapLegend,
  ) => void;
}

const FRAME_SIZES = [1024, 2048, 4096];

function epochToLocalInput(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function AcousticPanel({ layerId, audioFile, gpxText, onLayerData }: Props) {
  const [decoded, setDecoded] = useState<DecodedAudio | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [gpxTrack, setGpxTrack] = useState<GpxTrack | null>(null);
  const [embedded, setEmbedded] = useState<EmbeddedTrackResult | null>(null);
  const [segments, setSegments] = useState<AcousticSegment[] | null>(null);
  const [segmentSec, setSegmentSec] = useState(DEFAULT_ANALYSIS_OPTIONS.segmentSec);
  const [frameSize, setFrameSize] = useState(DEFAULT_ANALYSIS_OPTIONS.frameSize);
  const [audioStart, setAudioStart] = useState<string>("");
  const [offsetSec, setOffsetSec] = useState(0);
  const [metric, setMetric] = useState<string>(meydaProvider.metricNames[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Decode audio when the file changes.
  useEffect(() => {
    setSegments(null);
    setDecoded(null);
    if (!audioFile) return;
    let cancelled = false;
    setDecoding(true);
    setError(null);
    decodeAudioFile(audioFile)
      .then((d) => {
        if (!cancelled) setDecoded(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDecoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioFile]);

  // A GPX upload (explicit) takes precedence; otherwise use a track embedded in
  // the audio file itself (e.g. GPS Audio Recorder recordings).
  const track = useMemo(
    () => gpxTrack ?? embedded?.track ?? null,
    [gpxTrack, embedded],
  );

  // Read a GPS track embedded in the audio file's metadata, when present. This
  // never fails fatally: a file without one just leaves `embedded` null and the
  // GPX upload remains the way to place windows on the map.
  useEffect(() => {
    setEmbedded(null);
    if (!audioFile) return;
    let cancelled = false;
    extractEmbeddedTrack(audioFile)
      .then((res) => {
        if (!cancelled && res) setEmbedded(res);
      })
      .catch(() => {
        /* not a recognised embedded-track file — fall back to GPX */
      });
    return () => {
      cancelled = true;
    };
  }, [audioFile]);

  // Parse an uploaded GPX when its text changes.
  useEffect(() => {
    if (!gpxText) {
      setGpxTrack(null);
      return;
    }
    try {
      setGpxTrack(parseGpx(gpxText.text, gpxText.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGpxTrack(null);
    }
  }, [gpxText]);

  // Default the audio start time from whichever track we have. An uploaded GPX
  // wins; an embedded track gives us an absolute start (its first fix), so no
  // manual entry is needed at all.
  useEffect(() => {
    if (gpxTrack) {
      const range = trackTimeRange(gpxTrack);
      if (range) setAudioStart(epochToLocalInput(range[0]));
    } else if (embedded && Number.isFinite(embedded.audioStartEpoch)) {
      setAudioStart(epochToLocalInput(embedded.audioStartEpoch));
    }
  }, [gpxTrack, embedded]);

  const runAnalysis = useCallback(async () => {
    if (!decoded) return;
    setRunning(true);
    setProgress(0);
    setError(null);
    try {
      const segs = await meydaProvider.analyze(
        { channelData: decoded.channelData, sampleRate: decoded.sampleRate },
        { segmentSec, frameSize },
        setProgress,
      );
      setSegments(segs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [decoded, segmentSec, frameSize]);

  const audioStartEpoch = useMemo(() => {
    const t = Date.parse(audioStart);
    return Number.isFinite(t) ? t : NaN;
  }, [audioStart]);

  const located = useMemo(() => {
    if (!segments || !track || !Number.isFinite(audioStartEpoch)) return null;
    return locateSegments(segments, track, { audioStartEpoch, offsetSec });
  }, [segments, track, audioStartEpoch, offsetSec]);

  // Push map data upward.
  useEffect(() => {
    const polyline: [number, number][] | undefined =
      track && track.points.length > 1
        ? track.points.map((p) => [p.lat, p.lon])
        : undefined;

    if (!located) {
      onLayerData(layerId, [], polyline);
      return;
    }
    const values = located.map((s) => s.metrics[metric]);
    const [lo, hi] = extent(values);
    const span = hi - lo || 1;
    const points: MapPoint[] = located
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s, i) => {
        const v = s.metrics[metric];
        const rows: [string, string][] = [
          ["Time", s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : "—"],
          ["Window", `${s.startSec.toFixed(0)}–${s.endSec.toFixed(0)} s`],
        ];
        for (const m of meydaProvider.metricNames) {
          rows.push([METRIC_LABELS[m] ?? m, s.metrics[m].toFixed(2)]);
        }
        return {
          id: i,
          lat: s.lat!,
          lon: s.lon!,
          color: Number.isFinite(v) ? sequentialColor((v - lo) / span) : "#ccc",
          label: `${s.startSec.toFixed(0)} s`,
          rows,
        };
      });
    const legend: MapLegend | undefined = Number.isFinite(lo)
      ? {
          kind: "gradient",
          label: METRIC_LABELS[metric] ?? metric,
          min: lo,
          max: hi,
          colors: sequentialSwatches(12),
        }
      : undefined;
    onLayerData(layerId, points, polyline, legend);
  }, [layerId, located, track, metric, onLayerData]);

  const locatedCount = located?.filter((s) => Number.isFinite(s.lat)).length ?? 0;
  const embeddedActive = !gpxTrack && !!embedded;

  return (
    <div className="panel-body">
      {!audioFile && (
        <p className="muted">
          Upload an audio file above. If it has a GPS track embedded (e.g. a GPS
          Audio Recorder recording) it maps on its own; otherwise add a GPX.
        </p>
      )}

      {decoding && <p className="muted">Decoding audio…</p>}
      {decoded && (
        <p className="muted">
          Audio: {decoded.duration.toFixed(1)} s · {(decoded.sampleRate / 1000).toFixed(1)} kHz
        </p>
      )}
      {embeddedActive && (
        <p className="muted">
          ✓ GPS track read from the audio file — no GPX needed.
        </p>
      )}
      {track && (
        <p className="muted">
          Track: {track.name} · {track.points.length} points
          {embeddedActive ? " · embedded" : ""}
        </p>
      )}

      <section>
        <h3>Analysis windows</h3>
        <label className="field">
          Window length: <strong>{segmentSec}s</strong>
          <input
            type="range"
            min={1}
            max={30}
            value={segmentSec}
            onChange={(e) => setSegmentSec(Number(e.target.value))}
          />
        </label>
        <label className="field">
          FFT frame size
          <select value={frameSize} onChange={(e) => setFrameSize(Number(e.target.value))}>
            {FRAME_SIZES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!decoded || running} onClick={runAnalysis}>
          {running ? `Analysing… ${Math.round(progress * 100)}%` : "Run analysis"}
        </button>
        {running && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </section>

      {segments && (
        <section>
          <h3>Align to track</h3>
          <label className="field">
            Audio start time
            <input
              type="datetime-local"
              step={1}
              value={audioStart}
              onChange={(e) => setAudioStart(e.target.value)}
            />
          </label>
          {embeddedActive && (
            <p className="muted small">
              Auto-detected from the embedded GPS track; adjust if needed.
            </p>
          )}
          <label className="field">
            Offset: <strong>{offsetSec}s</strong>
            <input
              type="range"
              min={-120}
              max={120}
              value={offsetSec}
              onChange={(e) => setOffsetSec(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            {segments.length} windows · {locatedCount} placed on the track
          </p>
          {!Number.isFinite(audioStartEpoch) && (
            <p className="error">Set a valid audio start time to place windows on the map.</p>
          )}
          {!track && (
            <p className="error">
              No GPS track found in the audio file — upload a GPX track to place
              windows on the map.
            </p>
          )}
        </section>
      )}

      {segments && (
        <section>
          <h3>Map colour</h3>
          <label className="field">
            Colour windows by
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              {meydaProvider.metricNames.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
