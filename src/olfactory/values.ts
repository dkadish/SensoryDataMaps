import type { EnvKey, EnvReadings, OlfactorySample } from "../types";

export const ENV_LABELS: Record<EnvKey, string> = {
  temperatureC: "Temperature (°C)",
  humidityPct: "Humidity (%)",
  pressureHpa: "Pressure (hPa)",
  gasResistanceOhm: "Air quality (gas Ω)",
  altitudeM: "Altitude (m)",
};

// Display order for environmental metrics.
export const ENV_ORDER: EnvKey[] = [
  "temperatureC",
  "humidityPct",
  "pressureHpa",
  "gasResistanceOhm",
  "altitudeM",
];

/**
 * Look up a channel value on a sample. A channel key is either a gas/feature
 * name (in `features`) or an environmental key (in `env`); these never collide.
 */
export function sampleValue(s: OlfactorySample, key: string): number {
  const f = s.features[key];
  if (Number.isFinite(f)) return f;
  if (s.env) {
    const v = s.env[key as keyof EnvReadings];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return NaN;
}
