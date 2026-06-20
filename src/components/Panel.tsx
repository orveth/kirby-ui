// The shared panel chrome: a titled, framed surface with a corner-bracket motif.
// Every mission-control panel sits in one of these so the layout reads as one
// instrument cluster rather than a stack of cards.

import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** Small descriptor under the title (often "kind NNNNN"). */
  sub?: string;
  /** Right-aligned status chip in the panel header (e.g. "2/3 alive"). */
  meta?: ReactNode;
  /** Make this panel span the full width of the grid. */
  wide?: boolean;
  children: ReactNode;
}

export function Panel({ title, sub, meta, wide, children }: PanelProps) {
  return (
    <section className={`panel${wide ? " panel--wide" : ""}`}>
      {/* decorative corner brackets — the instrument-bezel look */}
      <span className="panel-corner panel-corner--tl" aria-hidden="true" />
      <span className="panel-corner panel-corner--br" aria-hidden="true" />

      <div className="panel-head">
        <div className="panel-head-left">
          <h2 className="panel-title">{title}</h2>
          {sub && <span className="panel-sub mono">{sub}</span>}
        </div>
        {meta != null && <span className="panel-meta mono">{meta}</span>}
      </div>

      <div className="panel-body">{children}</div>
    </section>
  );
}
