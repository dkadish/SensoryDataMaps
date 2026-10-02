import { useState, type ReactNode } from "react";
import type { RenderMode } from "./MapView";
import { RENDER_MODES } from "./LayerCard";
import {
  CLUSTER_MODE,
  maxClusters,
  type OlfactorySettings,
} from "./OlfactoryPanel";
import { LINKAGE_METHODS, type LinkageMethod } from "../olfactory/clustering";
import { meydaProvider, METRIC_LABELS } from "../acoustic/meydaProvider";
import type { OlfactoryDataset } from "../types";

/** A layer as listed in the group controls' "Apply to" picker. */
export interface GroupMember {
  id: string;
  name: string;
  accent: string;
  /** Whether changes made here are applied to this layer. */
  included: boolean;
}

interface Props {
  /** E.g. "olfactory" — used in the heading ("Control all olfactory layers"). */
  kindLabel: string;
  members: GroupMember[];
  onToggleMember: (id: string) => void;
  /** The shared map style of the targeted layers, or null when they differ. */
  renderMode: RenderMode | null;
  onRenderModeChange: (mode: RenderMode) => void;
  onSetVisible: (visible: boolean) => void;
  /** Kind-specific controls (colour, clustering, …). */
  children?: ReactNode;
}

/** Find the value every item shares, or null when they differ (or none exist). */
export function common<T>(values: T[], eq: (a: T, b: T) => boolean = Object.is): T | null {
  if (values.length === 0) return null;
  return values.every((v) => eq(v, values[0])) ? values[0] : null;
}

/** Controls that change several layers of one kind at once. Each control shows
 *  the value the targeted layers share, or "mixed" when they differ; changing it
 *  sets that value on every targeted layer. Per-layer controls stay available
 *  in each layer's card for fine-tuning afterwards. */
export default function GroupControls({
  kindLabel,
  members,
  onToggleMember,
  renderMode,
  onRenderModeChange,
  onSetVisible,
  children,
}: Props) {
  const [open, setOpen] = useState(true);
  const targetCount = members.filter((m) => m.included).length;

  return (
    <div className="layer-card group-card">
      <div className="layer-head">
        <button
          className="layer-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="layer-name">Control all {kindLabel} layers</span>
        <span className="muted small">
          {targetCount}/{members.length}
        </span>
      </div>
      {open && (
        <div className="layer-content">
          <div className="panel-body">
            <section>
              <h3>Apply to</h3>
              <div className="chips">
                {members.map((m) => (
                  <label key={m.id} className={`chip ${m.included ? "on" : ""}`} title={m.name}>
                    <input
                      type="checkbox"
                      checked={m.included}
                      onChange={() => onToggleMember(m.id)}
                    />
                    <span className="swatch" style={{ background: m.accent }} />
                    {m.name}
                  </label>
                ))}
              </div>
            </section>

            {targetCount === 0 ? (
              <p className="muted small">Select at least one layer to control.</p>
            ) : (
              <>
                <section>
                  <h3>Display</h3>
                  <div className="group-row">
                    <span className="muted small">Style</span>
                    <div className="segmented">
                      {RENDER_MODES.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          className={`seg ${renderMode === m.value ? "on" : ""}`}
                          title={m.title}
                          aria-pressed={renderMode === m.value}
                          onClick={() => onRenderModeChange(m.value)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {renderMode === null && <span className="muted small">mixed</span>}
                  </div>
                  <div className="group-row">
                    <span className="muted small">Visibility</span>
                    <div className="segmented">
                      <button type="button" className="seg" onClick={() => onSetVisible(true)}>
                        Show all
                      </button>
                      <button type="button" className="seg" onClick={() => onSetVisible(false)}>
                        Hide all
                      </button>
                    </div>
                  </div>
                </section>
                {children}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One targeted olfactory layer, as seen by the group colour/clustering controls. */
export interface OlfactoryTarget {
  dataset: OlfactoryDataset;
  settings: OlfactorySettings;
}

/** Applies a settings change to every targeted layer. The callback returns the
 *  patch for one layer, or null to leave that layer untouched (e.g. when it
 *  lacks the chosen channel). */
export type ApplyOlfactory = (
  patch: (dataset: OlfactoryDataset, settings: OlfactorySettings) => Partial<OlfactorySettings> | null,
) => void;

/** Whether a dataset has a gas channel or env metric with this key. */
function hasChannel(dataset: OlfactoryDataset, key: string): boolean {
  return dataset.featureChannels.includes(key) || dataset.envChannels.some((e) => e.key === key);
}

const MIXED = "__mixed__";

/** Colour + clustering controls for many olfactory layers at once. Channel lists
 *  are the union across the targeted layers; a channel only changes the layers
 *  that actually record it. */
export function OlfactoryGroupControls({
  targets,
  onApply,
}: {
  targets: OlfactoryTarget[];
  onApply: ApplyOlfactory;
}) {
  const gasChannels = [...new Set(targets.flatMap((t) => t.dataset.featureChannels))];
  const envChannels = new Map<string, string>();
  for (const t of targets) for (const e of t.dataset.envChannels) envChannels.set(e.key, e.label);
  const allKeys = [...gasChannels, ...envChannels.keys()];

  const colorMode = common(targets.map((t) => t.settings.colorMode));
  const method = common(targets.map((t) => t.settings.method));
  const k = common(targets.map((t) => t.settings.k));
  const kMax = Math.max(1, ...targets.map((t) => maxClusters(t.dataset)));

  // How many targeted layers lack the currently shared colour channel — those
  // keep their own colouring, so say so.
  const missingColor =
    colorMode && colorMode !== CLUSTER_MODE
      ? targets.filter((t) => !hasChannel(t.dataset, colorMode)).length
      : 0;

  // A channel chip is "on" when every targeted layer that records it uses it.
  const channelState = (c: string): "on" | "off" | "mixed" => {
    const having = targets.filter((t) => hasChannel(t.dataset, c));
    const on = having.filter((t) => t.settings.selected.includes(c)).length;
    return on === having.length ? "on" : on === 0 ? "off" : "mixed";
  };

  const toggleChannel = (c: string) => {
    const enable = channelState(c) !== "on";
    onApply((dataset, s) => {
      if (!hasChannel(dataset, c)) return null;
      const has = s.selected.includes(c);
      if (enable === has) return null;
      return { selected: enable ? [...s.selected, c] : s.selected.filter((x) => x !== c) };
    });
  };

  return (
    <>
      <section>
        <h3>Map colour</h3>
        <label className="field">
          Colour points by
          <select
            value={colorMode ?? MIXED}
            onChange={(e) => {
              const mode = e.target.value;
              onApply((dataset) =>
                mode === CLUSTER_MODE || hasChannel(dataset, mode) ? { colorMode: mode } : null,
              );
            }}
          >
            {colorMode === null && (
              <option value={MIXED} disabled>
                (mixed)
              </option>
            )}
            <option value={CLUSTER_MODE}>Cluster</option>
            {gasChannels.map((c) => (
              <option key={c} value={c}>
                {c} (value)
              </option>
            ))}
            {[...envChannels].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {missingColor > 0 && (
          <p className="muted small">
            {missingColor} layer{missingColor > 1 ? "s don't" : " doesn't"} record this
            channel and keep{missingColor > 1 ? "" : "s"} its own colouring.
          </p>
        )}
      </section>

      <section>
        <h3>Hierarchical clustering</h3>
        <label className="field">
          Linkage
          <select
            value={method ?? MIXED}
            onChange={(e) => {
              const m = e.target.value as LinkageMethod;
              onApply(() => ({ method: m }));
            }}
          >
            {method === null && (
              <option value={MIXED} disabled>
                (mixed)
              </option>
            )}
            {LINKAGE_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Clusters (k): <strong>{k ?? "mixed"}</strong>
          </span>
          <input
            type="range"
            min={1}
            max={kMax}
            value={k ?? Math.round((1 + kMax) / 2)}
            onChange={(e) => {
              const v = Number(e.target.value);
              onApply((dataset) => ({ k: Math.min(v, maxClusters(dataset)) }));
            }}
          />
        </label>
        {allKeys.length > 0 && (
          <>
            <p className="muted small">Channels for clustering</p>
            <div className="chips">
              {allKeys.map((c) => {
                const state = channelState(c);
                const env = envChannels.has(c);
                return (
                  <label
                    key={c}
                    className={`chip ${env ? "env" : ""} ${state === "on" ? "on" : ""} ${state === "mixed" ? "mixed" : ""}`}
                    title={state === "mixed" ? "Used by some layers" : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={state === "on"}
                      onChange={() => toggleChannel(c)}
                    />
                    {envChannels.get(c) ?? c}
                  </label>
                );
              })}
            </div>
          </>
        )}
      </section>
    </>
  );
}

/** Colour control for many acoustic layers at once. */
export function AcousticGroupControls({
  metrics,
  onChange,
}: {
  /** The metric each targeted layer is coloured by. */
  metrics: string[];
  onChange: (metric: string) => void;
}) {
  const metric = common(metrics);
  return (
    <section>
      <h3>Map colour</h3>
      <label className="field">
        Colour windows by
        <select value={metric ?? MIXED} onChange={(e) => onChange(e.target.value)}>
          {metric === null && (
            <option value={MIXED} disabled>
              (mixed)
            </option>
          )}
          {meydaProvider.metricNames.map((m) => (
            <option key={m} value={m}>
              {METRIC_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
