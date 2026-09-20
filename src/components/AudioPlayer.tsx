import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** The audio file to play. A fresh object URL is made for it. */
  file: File;
  /** The layer's identity colour, used to tint the playhead marker. */
  accent: string;
  /**
   * Called with the current playback time (seconds from the start of the file)
   * whenever it advances, and on seek. Should be a stable callback.
   */
  onTime?: (sec: number) => void;
  /** Called when playback starts or stops so listeners can show/hide a playhead. */
  onPlayingChange?: (playing: boolean) => void;
}

/** Window and FFT size for the short-time Fourier transform. Power of two. */
const FFT_SIZE = 1024;
/** How many time columns to compute across the whole file. */
const MAX_COLUMNS = 1200;
/** Floor of the dB range shown; anything quieter maps to the darkest colour. */
const DB_FLOOR = -90;
/** Ceiling of the dB range shown. */
const DB_CEIL = -20;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** The precomputed spectrogram of a whole file. */
interface Spectrogram {
  /** Number of time columns. */
  columns: number;
  /** Number of frequency bins per column (FFT_SIZE / 2). */
  bins: number;
  /** columns × bins magnitudes, normalised to 0..1 across the dB window. */
  data: Float32Array;
  /** Source sample rate, for the frequency axis. */
  sampleRate: number;
  /** File duration in seconds. */
  duration: number;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 *
 * `re`/`im` hold the complex signal (length must be a power of two) and are
 * overwritten with its transform. Kept dependency-free so the spectrogram can
 * be computed from decoded PCM without a live AnalyserNode.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + (len >> 1)];
        const bIm = im[i + k + (len >> 1)];
        const tRe = bRe * curRe - bIm * curIm;
        const tIm = bRe * curIm + bIm * curRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + (len >> 1)] = aRe - tRe;
        im[i + k + (len >> 1)] = aIm - tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Decode a file to mono PCM and compute a short-time Fourier transform across
 * its whole length. The number of columns is capped so long recordings stay
 * cheap to compute and fit the display, with each column an FFT window sampled
 * evenly along the file.
 */
async function computeSpectrogram(file: File): Promise<Spectrogram> {
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    const sampleRate = buffer.sampleRate;
    const duration = buffer.duration;
    const frames = buffer.length;

    // Mix all channels down to mono.
    const mono = new Float32Array(frames);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < frames; i++) mono[i] += d[i];
    }
    if (buffer.numberOfChannels > 1) {
      for (let i = 0; i < frames; i++) mono[i] /= buffer.numberOfChannels;
    }

    const bins = FFT_SIZE / 2;
    const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(frames / (FFT_SIZE / 4))));
    const data = new Float32Array(columns * bins);

    // Precompute a Hann window to reduce spectral leakage.
    const win = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }

    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    const lastStart = Math.max(0, frames - FFT_SIZE);
    const range = DB_CEIL - DB_FLOOR;

    for (let c = 0; c < columns; c++) {
      const start = columns > 1 ? Math.round((c * lastStart) / (columns - 1)) : 0;
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = start + i;
        re[i] = s < frames ? mono[s] * win[i] : 0;
        im[i] = 0;
      }
      fft(re, im);
      const base = c * bins;
      for (let b = 0; b < bins; b++) {
        const mag = Math.hypot(re[b], im[b]) / FFT_SIZE;
        const db = 20 * Math.log10(mag + 1e-9);
        let v = (db - DB_FLOOR) / range;
        if (v < 0) v = 0;
        else if (v > 1) v = 1;
        data[base + b] = v;
      }
    }

    return { columns, bins, data, sampleRate, duration };
  } finally {
    void ctx.close();
  }
}

/**
 * Map a normalised intensity (0..1) to an "inferno"-style heatmap colour.
 * Standard for spectrograms: dark for quiet, hot yellow for loud. Returns
 * [r, g, b] bytes.
 */
function heat(v: number): [number, number, number] {
  // Piecewise-linear through inferno control points.
  const stops: Array<[number, number, number, number]> = [
    [0.0, 0, 0, 4],
    [0.15, 40, 11, 84],
    [0.3, 101, 21, 110],
    [0.45, 159, 42, 99],
    [0.6, 212, 72, 66],
    [0.75, 245, 125, 21],
    [0.9, 250, 193, 39],
    [1.0, 252, 255, 164],
  ];
  let i = 0;
  while (i < stops.length - 1 && v > stops[i + 1][0]) i++;
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[Math.min(i + 1, stops.length - 1)];
  const f = t1 > t0 ? (v - t0) / (t1 - t0) : 0;
  return [
    Math.round(r0 + (r1 - r0) * f),
    Math.round(g0 + (g1 - g0) * f),
    Math.round(b0 + (b1 - b0) * f),
  ];
}

/**
 * Audio playback for an acoustic layer, with a scrolling spectrogram.
 *
 * The whole file is decoded once and turned into a short-time Fourier transform
 * (time × frequency, magnitude as a heatmap), rendered into an offscreen canvas.
 * On every animation frame while playing — and on seek — that heatmap is blitted
 * to the visible canvas and a vertical marker is drawn at the current playback
 * time, so the spectrum scrolls past a fixed "now" line. The current time is
 * reported upward (via `onTime`) so a caller can place a moving marker on the
 * GPS track.
 */
export default function AudioPlayer({ file, accent, onTime, onPlayingChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Offscreen canvas holding the rendered heatmap at column × bin resolution.
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<Spectrogram | null>(null);

  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [showFft, setShowFft] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // A fresh object URL per file; revoke it when the file changes or we unmount.
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setPlaying(false);
    setCurrent(0);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Decode the file and build the spectrogram whenever the file changes.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    specRef.current = null;
    specCanvasRef.current = null;
    computeSpectrogram(file)
      .then((spec) => {
        if (cancelled) return;
        specRef.current = spec;
        setSampleRate(spec.sampleRate);
        if (spec.duration) setDuration(spec.duration);

        // Paint the heatmap into an offscreen canvas at native resolution.
        const off = document.createElement("canvas");
        off.width = spec.columns;
        off.height = spec.bins;
        const og = off.getContext("2d");
        if (og) {
          const img = og.createImageData(spec.columns, spec.bins);
          for (let c = 0; c < spec.columns; c++) {
            const base = c * spec.bins;
            for (let b = 0; b < spec.bins; b++) {
              // Row 0 is the top of the image → highest frequency at the top.
              const y = spec.bins - 1 - b;
              const [r, g, bl] = heat(spec.data[base + b]);
              const p = (y * spec.columns + c) * 4;
              img.data[p] = r;
              img.data[p + 1] = g;
              img.data[p + 2] = bl;
              img.data[p + 3] = 255;
            }
          }
          og.putImageData(img, 0, 0);
        }
        specCanvasRef.current = off;
        setStatus("ready");
        // Draw once immediately so the spectrogram shows before playback.
        requestAnimationFrame(() => draw());
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // `draw` is stable (its inputs come from refs); listing it would re-decode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /** Blit the heatmap to the visible canvas and draw the playhead marker. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const off = specCanvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    // Match the backing store to the element's display size (× DPR).
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 140;
    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    const w = canvas.width;
    const h = canvas.height;

    g.clearRect(0, 0, w, h);
    if (off) {
      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
    }

    // Vertical playhead marker at the current time.
    const dur = specRef.current?.duration || duration;
    if (dur > 0) {
      const x = Math.min(w - 1, Math.max(0, (current / dur) * w));
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.fillRect(x - Math.max(1, dpr), 0, Math.max(1.5, dpr * 1.5), h);
      g.fillStyle = accent;
      g.fillRect(x - Math.max(1, dpr), 0, Math.max(1.5, dpr * 1.5), Math.max(3, dpr * 3));
    }
  }, [accent, current, duration]);

  // While playing, advance the clock and repaint the spectrogram every frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrent(audio.currentTime);
        onTime?.(audio.currentTime);
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, onTime]);

  // Repaint on seek / resize when paused (playing repaints continuously).
  useEffect(() => {
    if (!playing) draw();
  }, [current, showFft, status, playing, draw]);

  const handlePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await audio.play();
    } catch {
      /* play() can reject if interrupted — ignore, the pause handler resyncs */
    }
  }, []);

  const handlePause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const handleSeek = useCallback(
    (sec: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = sec;
      setCurrent(sec);
      onTime?.(sec);
    },
    [onTime],
  );

  const nyquist = sampleRate / 2;

  return (
    <div className="audio-player">
      {/* Hidden media element — the transport UI below drives it. */}
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => {
          setPlaying(true);
          onPlayingChange?.(true);
        }}
        onPause={() => {
          setPlaying(false);
          onPlayingChange?.(false);
        }}
        onEnded={() => {
          setPlaying(false);
          onPlayingChange?.(false);
        }}
      />

      <div className="player-transport">
        <button
          type="button"
          className="player-btn"
          onClick={playing ? handlePause : handlePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          className="player-seek"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(current, duration || 0)}
          onChange={(e) => handleSeek(Number(e.target.value))}
        />
        <span className="player-time">
          {fmtTime(current)} / {fmtTime(duration)}
        </span>
      </div>

      <label className="player-fft-toggle">
        <input
          type="checkbox"
          checked={showFft}
          onChange={(e) => setShowFft(e.target.checked)}
        />
        Show spectrogram
      </label>

      {showFft && (
        <div className="fft-view">
          <div className="spectrogram">
            {sampleRate > 0 && (
              <div className="spectrogram-yaxis" aria-hidden="true">
                <span>{(nyquist / 1000).toFixed(1)} kHz</span>
                <span>{(nyquist / 2000).toFixed(1)} kHz</span>
                <span>0</span>
              </div>
            )}
            <div className="spectrogram-plot">
              <canvas ref={canvasRef} width={300} height={140} className="fft-canvas" />
              {status === "loading" && (
                <div className="spectrogram-overlay">Analysing audio…</div>
              )}
              {status === "error" && (
                <div className="spectrogram-overlay">
                  Couldn’t analyse this file’s audio.
                </div>
              )}
            </div>
          </div>
          <div className="fft-axis spectrogram-xaxis">
            <span>0:00</span>
            <span>time →</span>
            <span>{fmtTime(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
