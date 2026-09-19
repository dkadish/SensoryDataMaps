import { useState, type ReactNode } from "react";
import type { RenderMode } from "./MapView";

const RENDER_MODES: { value: RenderMode; label: string; title: string }[] = [
  { value: "circles", label: "Circles", title: "A coloured circle per sample" },
  { value: "streak", label: "Streak", title: "A single line whose colour changes along the walk" },
  { value: "both", label: "Both", title: "Circles over the colour-changing streak" },
];

interface Props {
  name: string;
  kindLabel: string;
  accent: string;
  visible: boolean;
  /** How this layer draws its samples on the map. */
  renderMode: RenderMode;
  /** Number of points this layer currently draws on the map. */
  pointCount: number;
  onToggleVisible: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onRenderModeChange: (mode: RenderMode) => void;
  children: ReactNode;
}

/** Chrome around one layer's controls: an accent-coloured header with the layer
 *  name, a visibility toggle, a remove button and a collapse/expand affordance.
 *  The layer's own panel (olfactory or acoustic) is rendered as children. */
export default function LayerCard({
  name,
  kindLabel,
  accent,
  visible,
  renderMode,
  pointCount,
  onToggleVisible,
  onRemove,
  onRename,
  onRenderModeChange,
  children,
}: Props) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);

  return (
    <div className={`layer-card ${visible ? "" : "hidden-layer"}`}>
      <div className="layer-head">
        <span
          className="layer-accent"
          style={{ background: accent }}
          title={`${kindLabel} layer`}
        />
        <button
          className="layer-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        {editing ? (
          <input
            className="layer-name-input"
            value={name}
            autoFocus
            onChange={(e) => onRename(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            className="layer-name"
            title={name}
            onDoubleClick={() => setEditing(true)}
          >
            {name}
          </span>
        )}
        <div className="layer-actions">
          <button
            className="icon-btn"
            onClick={() => setEditing(true)}
            title="Rename layer"
            aria-label="Rename layer"
          >
            ✎
          </button>
          <label
            className="icon-btn"
            title={visible ? "Hide layer" : "Show layer"}
            aria-label={visible ? "Hide layer" : "Show layer"}
          >
            <input
              type="checkbox"
              checked={visible}
              onChange={onToggleVisible}
            />
            {visible ? "👁" : "🚫"}
          </label>
          <button
            className="icon-btn danger"
            onClick={onRemove}
            title="Remove layer"
            aria-label="Remove layer"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="layer-meta">
        <span className="layer-kind">{kindLabel}</span>
        <span className="muted small">
          {pointCount > 0 ? `${pointCount.toLocaleString()} points on map` : "not yet mapped"}
        </span>
      </div>
      <div className="layer-render" role="group" aria-label="Map style">
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
      </div>
      {open && <div className="layer-content">{children}</div>}
    </div>
  );
}
