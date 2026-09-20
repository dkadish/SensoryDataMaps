import { type ReactNode } from "react";

interface Props {
  /** Short summary shown on the always-visible header line. */
  title?: string;
  /** When true the callout starts expanded; otherwise it's collapsed. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A collapsible "Help" callout for inline usage instructions. Rendered as a
 *  native <details>/<summary> so it works without JS and stays accessible; the
 *  header carries a ⓘ marker and a "Help" label. Keep the body concise — these
 *  sit next to the controls they explain. */
export default function HelpCallout({ title = "Help", defaultOpen = false, children }: Props) {
  return (
    <details className="help-callout" open={defaultOpen}>
      <summary className="help-summary">
        <span className="help-icon" aria-hidden="true">
          ⓘ
        </span>
        {title}
      </summary>
      <div className="help-body">{children}</div>
    </details>
  );
}
