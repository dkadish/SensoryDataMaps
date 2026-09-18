// Small numeric helpers with no dependencies.

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stddev(xs: number[], mu = mean(xs)): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Column-wise z-score normalisation of a matrix (rows = samples, cols =
 * features). Constant columns are left as zeros. Returns a new matrix.
 */
export function zScoreColumns(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const nCols = rows[0].length;
  const means: number[] = [];
  const sds: number[] = [];
  for (let c = 0; c < nCols; c++) {
    const col = rows.map((r) => r[c]);
    const mu = mean(col);
    means.push(mu);
    sds.push(stddev(col, mu) || 1);
  }
  return rows.map((r) => r.map((v, c) => (v - means[c]) / sds[c]));
}

/** Min / max of an array, ignoring NaN. Returns [NaN, NaN] if all NaN. */
export function extent(xs: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (Number.isFinite(x)) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  if (lo === Infinity) return [NaN, NaN];
  return [lo, hi];
}

/** Linear interpolation clamped to [0, 1] input domain. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
