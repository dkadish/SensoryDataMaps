// Shared domain types for Sensory Data Maps.
//
// The app treats every modality as "a set of georeferenced samples, each with a
// bag of numeric features". Olfactory samples carry gas-channel voltages;
// acoustic segments carry per-window audio metrics. Keeping a common shape lets
// the map, colouring and export code stay modality-agnostic.

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** BME680 environmental readings that may accompany an olfactory sample. */
export interface EnvReadings {
  temperatureC?: number;
  pressureHpa?: number;
  humidityPct?: number;
  gasResistanceOhm?: number;
  altitudeM?: number;
  airQuality?: number;
}

export interface OlfactorySample extends GeoPoint {
  /** Epoch milliseconds. NaN when the source row had no usable timestamp. */
  timestamp: number;
  /** Gas / feature channels, in volts (or raw units), keyed by channel name. */
  features: Record<string, number>;
  env?: EnvReadings;
  /** Walk identifier, when the export tags rows with one. */
  walkId?: string;
  /** GPS accuracy in metres, when present. */
  accuracyM?: number;
}

export interface OlfactoryDataset {
  kind: "olfactory";
  name: string;
  samples: OlfactorySample[];
  /** Ordered channel names present across the samples (used for clustering). */
  featureChannels: string[];
  /** Distinct walk ids found in the file, if any. */
  walkIds: string[];
}

/** A single point of a GPX track. */
export interface TrackPoint extends GeoPoint {
  /** Epoch milliseconds. */
  timestamp: number;
  elevation?: number;
}

export interface GpxTrack {
  name: string;
  points: TrackPoint[];
}

/** One analysis window of audio. Location is filled in after GPX sync. */
export interface AcousticSegment {
  /** Seconds from the start of the audio file. */
  startSec: number;
  endSec: number;
  /** Epoch milliseconds once the audio start time is known. */
  timestamp?: number;
  lat?: number;
  lon?: number;
  metrics: Record<string, number>;
}

export interface AcousticDataset {
  kind: "acoustic";
  name: string;
  segments: AcousticSegment[];
  /** Names of the scalar metrics computed per segment. */
  metricNames: string[];
  durationSec: number;
  sampleRate: number;
  /** The analysis provider that produced these metrics. */
  providerId: string;
}

export type Dataset = OlfactoryDataset | AcousticDataset;
