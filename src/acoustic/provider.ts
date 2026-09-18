import type { AcousticSegment } from "../types";

export interface AudioAnalysisInput {
  channelData: Float32Array;
  sampleRate: number;
}

export interface AnalysisOptions {
  /** Length of each mapped analysis window, in seconds. */
  segmentSec: number;
  /** FFT frame size (power of two). */
  frameSize: number;
}

/**
 * Pluggable acoustic-analysis engine. The MVP ships one implementation
 * (`meydaProvider`) computing basic per-window metrics in the browser. A future
 * `scikit-maad`-parity engine — via Pyodide (WASM) or a small Python service —
 * implements this same interface to add ecoacoustic indices (ACI, NDSI, ADI,
 * AEI, BI, Ht, Hf) without touching the rest of the app.
 */
export interface AcousticAnalysisProvider {
  id: string;
  label: string;
  description: string;
  /** Scalar metric keys this provider produces for each segment. */
  metricNames: string[];
  analyze(
    input: AudioAnalysisInput,
    opts: AnalysisOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<AcousticSegment[]>;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  segmentSec: 5,
  frameSize: 2048,
};
