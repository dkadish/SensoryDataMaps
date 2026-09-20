import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** The audio file to play. A fresh object URL is made for it. */
  file: File;
  /** The layer's identity colour, used to tint the FFT spectrum. */
  accent: string;
  /**
   * Called with the current playback time (seconds from the start of the file)
   * whenever it advances, and on seek. Should be a stable callback.
   */
  onTime?: (sec: number) => void;
  /** Called when playback starts or stops so listeners can show/hide a playhead. */
  onPlayingChange?: (playing: boolean) => void;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Audio playback for an acoustic layer, with a live FFT spectrum.
 *
 * The file is played through a Web Audio graph — a single MediaElementSource
 * feeds an AnalyserNode and the speakers — so we can read the running frequency
 * spectrum for the visualiser. The graph is built lazily on first play, inside
 * the user gesture, to satisfy browser autoplay policies. The current playback
 * time is reported upward (via `onTime`) on every animation frame while playing
 * and on seek, so a caller can place a moving marker on the GPS track.
 */
export default function AudioPlayer({ file, accent, onTime, onPlayingChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [showFft, setShowFft] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);

  // A fresh object URL per file; revoke it when the file changes or we unmount.
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setPlaying(false);
    setCurrent(0);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Tear the Web Audio graph down on unmount so contexts don't leak.
  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, []);

  /** Build the analyser graph once, on the first play (a user gesture). */
  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || ctxRef.current) return ctxRef.current;
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
    freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    setSampleRate(ctx.sampleRate);
    return ctx;
  }, []);

  /** Draw the current frequency spectrum into the canvas. */
  const drawFft = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const freq = freqRef.current;
    if (!canvas || !analyser || !freq) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    // Match the backing store to the element's display size (× DPR) so the bars
    // stay crisp as the sidebar width changes.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 110;
    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }

    analyser.getByteFrequencyData(freq);
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);

    const bins = freq.length;
    // A vertical accent gradient makes the spectrum read at a glance.
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, "#ffffff");
    g.fillStyle = grad;

    const barW = w / bins;
    for (let i = 0; i < bins; i++) {
      const v = freq[i] / 255;
      const barH = v * h;
      g.fillRect(i * barW, h - barH, Math.max(1, barW), barH);
    }
  }, [accent]);

  // While playing, advance the clock and repaint the spectrum every frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrent(audio.currentTime);
        onTime?.(audio.currentTime);
      }
      drawFft();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, drawFft, onTime]);

  const handlePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = ensureGraph();
    if (ctx && ctx.state === "suspended") await ctx.resume();
    try {
      await audio.play();
    } catch {
      /* play() can reject if interrupted — ignore, the pause handler resyncs */
    }
  }, [ensureGraph]);

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

  return (
    <div className="audio-player">
      {/* Hidden media element — the transport UI below drives it, and the Web
          Audio graph reads from it. */}
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
        Show FFT spectrum
      </label>

      {showFft && (
        <div className="fft-view">
          <canvas ref={canvasRef} width={300} height={110} className="fft-canvas" />
          {sampleRate > 0 && (
            <div className="fft-axis">
              <span>0</span>
              <span>{(sampleRate / 4000).toFixed(1)} kHz</span>
              <span>{(sampleRate / 2000).toFixed(1)} kHz</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
