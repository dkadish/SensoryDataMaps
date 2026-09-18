import { useCallback, useEffect, useMemo, useState } from "react";
import type { AcousticSegment, GpxTrack } from "../types";
import { decodeAudioFile, type DecodedAudio } from "../acoustic/audio";
import { parseGpx, trackTimeRange } from "../acoustic/gpx";
import { locateSegments } from "../acoustic/sync";
import { meydaProvider, METRIC_LABELS } from "../acoustic/meydaProvider";
import { DEFAULT_ANALYSIS_OPTIONS } from "../acoustic/provider";
import { sequentialColor } from "../lib/color";
import { extent } from "../lib/stats";
import type { MapPoint } from "./MapView";

interface Props {
  audioFile: File | null;
  gpxText: { text: string; name: string } | null;
  onMapData: (points: MapPoint[], polyline?: [number, number][]) => void;
}

const FRAME_SIZES = [1024, 2048, 4096];

function epochToLocalInput(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function AcousticPanel({ audioFile, gpxText, onMapData }: Props) {
  const [decoded, setDecoded] = useState<DecodedAudio | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [track, setTrack] = useState<GpxTrack | null>(null);
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

  // Parse GPX when its text changes; default the audio start to the track start.
  useEffect(() => {
    if (!gpxText) {
      setTrack(null);
      return;
    }
    try {
      const t = parseGpx(gpxText.text, gpxText.name);
      setTrack(t);
      const range = trackTimeRange(t);
      if (range) setAudioStart(epochToLocalInput(range[0]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTrack(null);
    }
  }, [gpxText]);

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
      onMapData([], polyline);
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
    onMapData(points, polyline);
  }, [located, track, metric, onMapData]);

  const locatedCount = located?.filter((s) => Number.isFinite(s.lat)).length ?? 0;

  return (
    <div className="panel-body">
      {!audioFile && <p className="muted">Upload an audio file and a GPX track above.</p>}

      {decoding && <p className="muted">Decoding audio…</p>}
      {decoded && (
        <p className="muted">
          Audio: {decoded.duration.toFixed(1)} s · {(decoded.sampleRate / 1000).toFixed(1)} kHz
        </p>
      )}
      {track && (
        <p className="muted">
          Track: {track.name} · {track.points.length} points
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
          {track === null && (
            <p className="error">Upload a GPX track to place windows on the map.</p>
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
