import { readArrayBuffer } from "../lib/readFile";

export interface DecodedAudio {
  /** Mono mixdown of the file. */
  channelData: Float32Array;
  sampleRate: number;
  duration: number;
}

type AudioCtor = typeof AudioContext;

/** Decode an audio file to a mono Float32Array using the Web Audio API. */
export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  const arrayBuf = await readArrayBuffer(file);
  const Ctor: AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API is not available in this browser.");

  const ctx = new Ctor();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const n = audioBuf.length;
    const channels = audioBuf.numberOfChannels;
    const mono = new Float32Array(n);
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += data[i];
    }
    if (channels > 1) {
      const inv = 1 / channels;
      for (let i = 0; i < n; i++) mono[i] *= inv;
    }
    return { channelData: mono, sampleRate: audioBuf.sampleRate, duration: audioBuf.duration };
  } catch {
    throw new Error(
      "Could not decode this audio file. Try WAV or MP3 — some browsers can't decode every format.",
    );
  } finally {
    void ctx.close();
  }
}
