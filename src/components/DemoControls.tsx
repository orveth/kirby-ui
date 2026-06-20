// The demo aside. The UI only OBSERVES signed events — it never drives custody or
// kills. The one button here is the forged-event injection: it runs a bad-sig
// event through the exact verify path the relay stream uses, proving the UI drops
// it (the rejected counter ticks; nothing renders). That's the honesty guarantee,
// made tangible. Kill/rug/earn are driven by the cluster (or the mock generator).

import { Seal } from "./Seal";

interface DemoControlsProps {
  injectForged: () => void;
}

export function DemoControls({ injectForged }: DemoControlsProps) {
  return (
    <aside className="demo">
      <div className="demo-left">
        <button type="button" className="forge-btn" onClick={injectForged}>
          <span className="forge-btn-x" aria-hidden="true">
            ✶
          </span>
          inject forged event
        </button>
        <p className="demo-caption">
          Every signature is verified. Forged state is <strong>rejected, never rendered</strong> — watch the
          rejected counter tick.
        </p>
      </div>

      <p className="demo-legend">
        <Seal size={13} title="observe-only" />
        Kill / rug actions are driven by the cluster (or the mock generator). The UI only observes
        signed events — it never drives custody.
      </p>
    </aside>
  );
}
