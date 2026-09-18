import Meyda from "meyda";
import type { AcousticSegment } from "../types";
import type {
  AcousticAnalysisProvider,
  AnalysisOptions,
  AudioAnalysisInput,
} from "./provider";

// Metric keys, in display order.
export const BASIC_METRICS = [
  "rms",
  "dbfs",
  "zcrHz",
  "spectralCentroidHz",
  "spectralRolloff85Hz",
  "spectralFlatness",
] as const;

export const METRIC_LABELS: Record<string, string> = {
  rms: "RMS level",
  dbfs: "Level (dBFS)",
  zcrHz: "Zero-crossing rate (Hz)",
  spectralCentroidHz: "Spectral centroid (Hz)",
  spectralRolloff85Hz: "Spectral rolloff 85% (Hz)",
  spectralFlatness: "Spectral flatness (0–1)",
};

interface FrameMetrics {
  rms: number;
  dbfs: number;
  zcrHz: number;
  spectralCentroidHz: number;
  spectralRolloff85Hz: number;
  spectralFlatness: number;
}

/** Spectral centroid (Hz) from a magnitude spectrum. */
function centroidHz(amp: number[], binHz: number): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < amp.length; i++) {
    num += i * binHz * amp[i];
    den += amp[i];
  }
  return den > 0 ? num / den : 0;
}

/** Frequency (Hz) below which `pct` of the spectral energy lies. */
function rolloffHz(amp: number[], binHz: number, pct: number): number {
  let total = 0;
  for (let i = 0; i < amp.length; i++) total += amp[i] * amp[i];
  if (total <= 0) return 0;
  const target = total * pct;
  let cum = 0;
  for (let i = 0; i < amp.length; i++) {
    cum += amp[i] * amp[i];
    if (cum >= target) return i * binHz;
  }
  return (amp.length - 1) * binHz;
}

function analyzeFrame(
  frame: Float32Array,
  sampleRate: number,
  frameSize: number,
): FrameMetrics {
  const f = Meyda.extract(
    ["rms", "zcr", "spectralFlatness", "amplitudeSpectrum"],
    frame,
  ) as {
    rms?: number;
    zcr?: number;
    spectralFlatness?: number;
    amplitudeSpectrum?: number[];
  };

  const rms = f.rms ?? 0;
  const amp = f.amplitudeSpectrum ?? [];
  const binHz = sampleRate / frameSize;
  const frameDurSec = frameSize / sampleRate;

  return {
    rms,
    dbfs: rms > 0 ? 20 * Math.log10(rms) : -120,
    zcrHz: (f.zcr ?? 0) / frameDurSec,
    spectralCentroidHz: centroidHz(amp, binHz),
    spectralRolloff85Hz: rolloffHz(amp, binHz, 0.85),
    spectralFlatness: f.spectralFlatness ?? 0,
  };
}

export const meydaProvider: AcousticAnalysisProvider = {
  id: "meyda-basic",
  label: "Basic metrics (Meyda, in-browser)",
  description:
    "Per-window RMS/level, zero-crossing rate, spectral centroid, 85% rolloff and flatness. Runs entirely in the browser.",
  metricNames: [...BASIC_METRICS],

  async analyze(
    input: AudioAnalysisInput,
    opts: AnalysisOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<AcousticSegment[]> {
    const { channelData, sampleRate } = input;
    const { frameSize, segmentSec } = opts;

    Meyda.sampleRate = sampleRate;
    Meyda.bufferSize = frameSize;

    const hop = frameSize; // no overlap — fast, adequate for basic metrics
    const totalFrames = Math.max(0, Math.floor((channelData.length - frameSize) / hop) + 1);

    // Accumulate frame metrics into segment buckets.
    const buckets = new Map<number, FrameMetrics[]>();
    let processed = 0;

    for (let p = 0; p + frameSize <= channelData.length; p += hop) {
      const frame = channelData.subarray(p, p + frameSize);
      const m = analyzeFrame(frame, sampleRate, frameSize);
      const centerSec = (p + frameSize / 2) / sampleRate;
      const segIdx = Math.floor(centerSec / segmentSec);
      let arr = buckets.get(segIdx);
      if (!arr) {
        arr = [];
        buckets.set(segIdx, arr);
      }
      arr.push(m);

      processed++;
      if (onProgress && processed % 250 === 0) {
        onProgress(processed / totalFrames);
        // Yield so the UI can paint the progress bar.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(1);

    const duration = channelData.length / sampleRate;
    const segments: AcousticSegment[] = [];
    const segIndices = [...buckets.keys()].sort((a, b) => a - b);
    for (const segIdx of segIndices) {
      const frames = buckets.get(segIdx)!;
      const metrics: Record<string, number> = {};
      for (const key of BASIC_METRICS) {
        let s = 0;
        for (const fr of frames) s += fr[key];
        metrics[key] = s / frames.length;
      }
      segments.push({
        startSec: segIdx * segmentSec,
        endSec: Math.min((segIdx + 1) * segmentSec, duration),
        metrics,
      });
    }
    return segments;
  },
};
