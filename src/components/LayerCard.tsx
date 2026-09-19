import { useState, type ReactNode } from "react";

interface Props {
  name: string;
  kindLabel: string;
  accent: string;
  visible: boolean;
  /** Number of points this layer currently draws on the map. */
  pointCount: number;
  onToggleVisible: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
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
  pointCount,
  onToggleVisible,
  onRemove,
  onRename,
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
      {open && <div className="layer-content">{children}</div>}
    </div>
  );
}
