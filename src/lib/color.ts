import { clamp01 } from "./stats";

// Colourblind-safe categorical palette (Okabe-Ito) for cluster colouring.
// https://jfly.uni-koeln.de/color/
export const CATEGORICAL: string[] = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#56B4E9", // sky blue
  "#D55E00", // vermillion
  "#F0E442", // yellow
  "#000000", // black
];

export function categoricalColor(i: number): string {
  return CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length];
}

// Viridis sequential colormap (8 anchor stops), perceptually uniform and
// colourblind-friendly. Interpolated in sRGB — good enough for map markers.
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [253, 231, 37],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Map t in [0,1] to a viridis hex colour. */
export function sequentialColor(t: number): string {
  const x = clamp01(t) * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i;
  const [r1, g1, b1] = VIRIDIS[i];
  const [r2, g2, b2] = VIRIDIS[i + 1];
  const r = lerp(r1, r2, f);
  const g = lerp(g1, g2, f);
  const b = lerp(b1, b2, f);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Build N evenly spaced viridis swatches for a legend. */
export function sequentialSwatches(n: number): string[] {
  return Array.from({ length: n }, (_, i) => sequentialColor(n === 1 ? 0.5 : i / (n - 1)));
}
