// The status bar: identity, the live verification crest, the relay link (status
// dot + editable URL), and the stream counters. The `rejected` counter is the
// headline honesty proof — it gets loud the moment it ticks above zero.

import { useEffect, useState } from "react";
import type { RelayStatus } from "../nostr/useCluster";
import type { ClusterState } from "../nostr/clusterState";
import { num } from "./format";
import { Seal } from "./Seal";

interface HeaderProps {
  relayStatus: RelayStatus;
  relayUrl: string;
  setRelayUrl: (url: string) => void;
  ingested: ClusterState["ingested"];
  rejected: ClusterState["rejected"];
  malformed: ClusterState["malformed"];
}

const STATUS_LABEL: Record<RelayStatus, string> = {
  connecting: "connecting",
  connected: "connected",
  error: "no relay",
};

/** The editable relay URL: commits on Enter or blur, never on every keystroke
 *  (a re-subscribe per keystroke would thrash the connection). */
function RelayField({ relayUrl, setRelayUrl }: Pick<HeaderProps, "relayUrl" | "setRelayUrl">) {
  const [draft, setDraft] = useState(relayUrl);
  // Keep the field in sync if the URL changes from elsewhere (e.g. ?relay=).
  useEffect(() => setDraft(relayUrl), [relayUrl]);

  const commit = () => {
    if (draft.trim() && draft.trim() !== relayUrl) setRelayUrl(draft);
  };

  return (
    <input
      className="relay-field mono"
      value={draft}
      spellCheck={false}
      aria-label="relay URL"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(relayUrl);
      }}
      onBlur={commit}
    />
  );
}

export function Header({ relayStatus, relayUrl, setRelayUrl, ingested, rejected, malformed }: HeaderProps) {
  const hasRejects = rejected > 0;

  return (
    <header className="header">
      <div className="header-brand">
        <div className="brand-crest" aria-hidden="true">
          <Seal size={26} animated />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">
            KIRBY<span className="brand-star" aria-hidden="true">★</span>
          </h1>
          <p className="brand-tag">
            try to kill it · try to rug it · <em>you can&apos;t — and it eats sats</em>
          </p>
        </div>
      </div>

      <div className="header-right">
        <div className="relay" data-status={relayStatus}>
          <span className={`relay-dot relay-dot--${relayStatus}`} aria-hidden="true" />
          <span className="relay-status mono">{STATUS_LABEL[relayStatus]}</span>
          <RelayField relayUrl={relayUrl} setRelayUrl={setRelayUrl} />
        </div>

        <div className="counters" aria-label="stream counters">
          <Counter label="verified" value={ingested} tone="ok" seal />
          <Counter label="rejected" value={rejected} tone={hasRejects ? "alarm" : "muted"} flare={hasRejects} />
          <Counter label="malformed" value={malformed} tone={malformed > 0 ? "warn" : "muted"} />
        </div>
      </div>
    </header>
  );
}

interface CounterProps {
  label: string;
  value: number;
  tone: "ok" | "alarm" | "warn" | "muted";
  /** Mark this counter with the signed seal (the verified-events tally). */
  seal?: boolean;
  /** Pulse when non-zero (the rejected counter, the "we caught a fake" beat). */
  flare?: boolean;
}

function Counter({ label, value, tone, seal, flare }: CounterProps) {
  return (
    <div className={`counter counter--${tone}${flare ? " counter--flare" : ""}`}>
      <span className="counter-value mono">{num(value)}</span>
      <span className="counter-label">
        {seal && <Seal size={11} title="every counted event is signature-verified" />}
        {label}
      </span>
    </div>
  );
}
