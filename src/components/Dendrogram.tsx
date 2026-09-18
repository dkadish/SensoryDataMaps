import { useMemo } from "react";
import type { Cluster } from "ml-hclust";
import { categoricalColor } from "../lib/color";

interface DendrogramProps {
  tree: Cluster;
  /** Cluster id per sample index (leaf), for colouring subtrees. */
  assignments: number[];
  height?: number;
}

interface Node {
  x: number;
  y: number; // data height (0 at leaves)
  cluster: number | null; // single cluster id if whole subtree shares one
  children: Node[];
}

const NEUTRAL = "#999";

/** Lay the tree out: leaves left-to-right, internal x = mean of children. */
function layout(
  cluster: Cluster,
  assignments: number[],
  counter: { i: number },
): Node {
  if (cluster.isLeaf || cluster.children.length === 0) {
    const x = counter.i++;
    return { x, y: 0, cluster: assignments[cluster.index] ?? null, children: [] };
  }
  const children = cluster.children.map((c) => layout(c, assignments, counter));
  const x = children.reduce((s, c) => s + c.x, 0) / children.length;
  const clusters = new Set(children.map((c) => c.cluster));
  const cluster0 = clusters.size === 1 ? children[0].cluster : null;
  return { x, y: cluster.height, cluster: cluster0, children };
}

export default function Dendrogram({ tree, assignments, height = 220 }: DendrogramProps) {
  const { segments, width, leafCount } = useMemo(() => {
    const counter = { i: 0 };
    const root = layout(tree, assignments, counter);
    const leaves = counter.i;
    const maxH = root.y || 1;

    const xStep = leaves > 120 ? 5 : leaves > 40 ? 9 : 16;
    const padL = 8;
    const padTop = 8;
    const padBottom = 8;
    const plotH = height - padTop - padBottom;

    const toX = (x: number) => padL + x * xStep;
    const toY = (dataY: number) => padTop + plotH * (1 - dataY / maxH);

    const segs: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    const walk = (n: Node) => {
      if (n.children.length === 0) return;
      const color = n.cluster != null ? categoricalColor(n.cluster) : NEUTRAL;
      const yTop = toY(n.y);
      for (const c of n.children) {
        // vertical from child up to this node's height
        segs.push({ x1: toX(c.x), y1: toY(c.y), x2: toX(c.x), y2: yTop, color: c.cluster != null ? categoricalColor(c.cluster) : NEUTRAL });
        walk(c);
      }
      // horizontal bar connecting the children
      const xs = n.children.map((c) => toX(c.x));
      segs.push({ x1: Math.min(...xs), y1: yTop, x2: Math.max(...xs), y2: yTop, color });
    };
    walk(root);

    return { segments: segs, width: padL * 2 + leaves * xStep, leafCount: leaves };
  }, [tree, assignments, height]);

  return (
    <div className="dendrogram-scroll">
      <svg width={Math.max(width, 200)} height={height} role="img" aria-label={`Dendrogram of ${leafCount} samples`}>
        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={s.color}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
}
