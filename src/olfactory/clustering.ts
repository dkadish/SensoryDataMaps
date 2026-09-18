import { agnes, type AgglomerationMethod, type Cluster } from "ml-hclust";
import type { OlfactoryDataset } from "../types";
import { mean, zScoreColumns } from "../lib/stats";
import { sampleValue } from "./values";

export type LinkageMethod = AgglomerationMethod;

export const LINKAGE_METHODS: LinkageMethod[] = [
  "ward",
  "complete",
  "average",
  "single",
];

export interface ClusterOptions {
  method: LinkageMethod;
  /** Number of clusters to cut the tree into. */
  k: number;
  /** Feature channels to include (subset of dataset.featureChannels). */
  channels: string[];
}

export interface ClusterResult {
  /** Cluster id (0-based) per sample, in dataset sample order. */
  assignments: number[];
  k: number;
  tree: Cluster;
  channelsUsed: string[];
  /** Leaf order (sample indices) for laying out the dendrogram. */
  order: number[];
}

/**
 * Build the feature matrix, imputing a missing cell with that channel's mean so
 * every row is complete. Columns are z-scored so channels with different ranges
 * contribute comparably.
 */
function buildMatrix(dataset: OlfactoryDataset, channels: string[]): number[][] {
  const colMeans = channels.map((c) => {
    const present = dataset.samples
      .map((s) => sampleValue(s, c))
      .filter((v) => Number.isFinite(v));
    return present.length ? mean(present) : 0;
  });

  const raw = dataset.samples.map((s) =>
    channels.map((c, ci) => {
      const v = sampleValue(s, c);
      return Number.isFinite(v) ? v : colMeans[ci];
    }),
  );

  return zScoreColumns(raw);
}

export interface OlfactoryTree {
  tree: Cluster;
  channelsUsed: string[];
  order: number[];
  n: number;
}

/** Build the linkage tree once; cutting it into k clusters is then cheap. */
export function buildOlfactoryTree(
  dataset: OlfactoryDataset,
  channels: string[],
  method: LinkageMethod,
): OlfactoryTree {
  const valid = new Set<string>([
    ...dataset.featureChannels,
    ...dataset.envChannels.map((e) => e.key),
  ]);
  const used = channels.filter((c) => valid.has(c));
  if (used.length === 0) {
    throw new Error("Select at least one channel to cluster on.");
  }
  const matrix = buildMatrix(dataset, used);
  const tree = agnes(matrix, { method });
  return { tree, channelsUsed: used, order: tree.indices(), n: dataset.samples.length };
}

/** Cut a linkage tree into k clusters, returning a cluster id per sample. */
export function cutTree(tree: Cluster, k: number, n: number): number[] {
  const kk = Math.max(1, Math.min(k, n));
  const assignments = new Array<number>(n).fill(0);
  if (kk > 1) {
    const grouped = tree.group(kk);
    grouped.children.forEach((child, clusterId) => {
      for (const idx of child.indices()) {
        assignments[idx] = clusterId;
      }
    });
  }
  return assignments;
}

export function clusterOlfactory(
  dataset: OlfactoryDataset,
  opts: ClusterOptions,
): ClusterResult {
  const built = buildOlfactoryTree(dataset, opts.channels, opts.method);
  const assignments = cutTree(built.tree, opts.k, built.n);
  const k = Math.max(1, Math.min(opts.k, built.n));
  return {
    assignments,
    k,
    tree: built.tree,
    channelsUsed: built.channelsUsed,
    order: built.order,
  };
}
