import { useMemo } from "react";

/** One spoke of the radar: a fingerprint channel with the dataset-wide range
 *  used to normalise every sample's value onto the same [0,1] axis, so plots
 *  from different samples are directly comparable when overlaid. */
export interface RadarAxis {
  key: string;
  label: string;
  min: number;
  max: number;
}

/** One sample's fingerprint drawn as a polygon: its raw channel values keyed by
 *  axis key, plus the colour and label used in the chart and its legend. */
export interface RadarSeries {
  id: string;
  label: string;
  color: string;
  values: Record<string, number>;
}

interface RadarChartProps {
  axes: RadarAxis[];
  series: RadarSeries[];
  size?: number;
}

// Concentric grid rings, as fractions of the full radius.
const RINGS = [0.25, 0.5, 0.75, 1];

/** Normalise a raw value onto [0,1] against an axis range. A degenerate range
 *  (all samples equal) maps to the mid-ring; a missing value returns NaN so the
 *  caller can drop that vertex. */
function norm(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return NaN;
  if (max <= min) return 0.5;
  const t = (v - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** An overlaid spider/radar chart of one or more fingerprints. Each axis is a
 *  channel scaled to the dataset-wide range for that channel, so a sample's
 *  shape reflects its relative response pattern and multiple samples can be
 *  compared vertex by vertex. */
export default function RadarChart({ axes, series, size = 260 }: RadarChartProps) {
  const geo = useMemo(() => {
    const n = axes.length;
    const cx = size / 2;
    const cy = size / 2;
    // Leave a margin for the axis labels that sit outside the outer ring.
    const R = size / 2 - 48;
    const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    const at = (i: number, r: number): [number, number] => {
      const a = angleAt(i);
      return [cx + r * R * Math.cos(a), cy + r * R * Math.sin(a)];
    };
    return { cx, cy, angleAt, at };
  }, [axes, size]);

  if (axes.length === 0) return null;
  const { cx, cy, angleAt, at } = geo;

  const ringPolys = RINGS.map((ring) =>
    axes.map((_, i) => at(i, ring).join(",")).join(" "),
  );

  const polyFor = (s: RadarSeries) =>
    axes
      .map((ax, i) => {
        const t = norm(s.values[ax.key], ax.min, ax.max);
        return at(i, Number.isFinite(t) ? t : 0).join(",");
      })
      .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="radar"
      role="img"
      aria-label={`Fingerprint radar chart of ${series.length} sample(s) across ${axes.length} channels`}
    >
      {ringPolys.map((pts, i) => (
        <polygon key={`ring-${i}`} points={pts} className="radar-ring" />
      ))}
      {axes.map((ax, i) => {
        const [x, y] = at(i, 1);
        const [lx, ly] = at(i, 1.16);
        const cos = Math.cos(angleAt(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        return (
          <g key={ax.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="radar-spoke" />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="radar-axis-label"
            >
              {ax.label}
            </text>
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.id}>
          <polygon
            points={polyFor(s)}
            fill={s.color}
            fillOpacity={0.14}
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {axes.map((ax, i) => {
            const t = norm(s.values[ax.key], ax.min, ax.max);
            if (!Number.isFinite(t)) return null;
            const [px, py] = at(i, t);
            return (
              <circle key={`${s.id}-${ax.key}`} cx={px} cy={py} r={2.6} fill={s.color}>
                <title>
                  {s.label} · {ax.label}: {s.values[ax.key]?.toFixed(3)}
                </title>
              </circle>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
