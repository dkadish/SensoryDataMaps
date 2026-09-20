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
  "spectralFlux",
] as const;

export const METRIC_LABELS: Record<string, string> = {
  rms: "RMS level",
  dbfs: "Level (dBFS)",
  zcrHz: "Zero-crossing rate (Hz)",
  spectralCentroidHz: "Spectral centroid (Hz)",
  spectralRolloff85Hz: "Spectral rolloff 85% (Hz)",
  spectralFlatness: "Spectral flatness (0–1)",
  spectralFlux: "Spectral flux",
};

interface FrameMetrics {
  rms: number;
  dbfs: number;
  zcrHz: number;
  spectralCentroidHz: number;
  spectralRolloff85Hz: number;
  spectralFlatness: number;
  spectralFlux: number;
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

/**
 * Spectral flux: the L2 norm of the half-wave-rectified, frame-to-frame change
 * in the magnitude spectrum. Only energy increases are counted, so the value
 * tracks onsets and rising, transient sounds. Returns 0 when there is no
 * previous frame to compare against.
 */
function fluxL2(amp: number[], prevAmp: number[]): number {
  if (prevAmp.length === 0) return 0;
  const n = Math.min(amp.length, prevAmp.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = amp[i] - prevAmp[i];
    if (d > 0) sum += d * d;
  }
  return Math.sqrt(sum);
}

function analyzeFrame(
  frame: Float32Array,
  sampleRate: number,
  frameSize: number,
  prevAmp: number[],
): { metrics: FrameMetrics; amp: number[] } {
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
    metrics: {
      rms,
      dbfs: rms > 0 ? 20 * Math.log10(rms) : -120,
      zcrHz: (f.zcr ?? 0) / frameDurSec,
      spectralCentroidHz: centroidHz(amp, binHz),
      spectralRolloff85Hz: rolloffHz(amp, binHz, 0.85),
      spectralFlatness: f.spectralFlatness ?? 0,
      spectralFlux: fluxL2(amp, prevAmp),
    },
    amp,
  };
}

export const meydaProvider: AcousticAnalysisProvider = {
  id: "meyda-basic",
  label: "Basic metrics (Meyda, in-browser)",
  description:
    "Per-window RMS/level, zero-crossing rate, spectral centroid, 85% rolloff, flatness and flux. Runs entirely in the browser.",
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
    let prevAmp: number[] = [];

    for (let p = 0; p + frameSize <= channelData.length; p += hop) {
      const frame = channelData.subarray(p, p + frameSize);
      const { metrics: m, amp } = analyzeFrame(frame, sampleRate, frameSize, prevAmp);
      prevAmp = amp;
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
