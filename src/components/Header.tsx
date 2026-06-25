// The status bar: identity, the live verification crest, the relay link (status
// dot + editable URL), and the stream counters. The `rejected` counter is the
// headline honesty proof — it gets loud the moment it ticks above zero.

import { useEffect, useState } from "react";
import type { RelayStatus } from "../nostr/useCluster";
import type { ClusterState } from "../nostr/clusterState";
import { num } from "./format";
import { Seal } from "./Seal";
import { LoginControl } from "./NostrLogin";

interface HeaderProps {
  relayStatus: RelayStatus;
  relayUrl: string;
  setRelayUrl: (url: string) => void;
  ingested: ClusterState["ingested"];
  rejected: ClusterState["rejected"];
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

export function Header({ relayStatus, relayUrl, setRelayUrl, ingested, rejected }: HeaderProps) {
  const hasRejects = rejected > 0;
  // Honest data-source badge: the UI only knows which relay it reads. The mock
  // demo relay is :7778; anything else is treated as a live relay. Derived purely
  // from the URL, so it flips to "live" automatically when pointed at :7777.
  const isMock = relayUrl.includes(":7778");

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
          <span
            className="data-source mono"
            title={
              isMock
                ? "Reading the MOCK demo relay (:7778) — a synthetic narrative for evaluating the look"
                : "Reading a LIVE relay — real signed cluster events"
            }
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: isMock ? "#ffe36e" : "#8bf5c6",
              background: isMock ? "rgba(255,227,110,0.14)" : "rgba(139,245,198,0.14)",
              border: `1px solid ${isMock ? "rgba(255,227,110,0.45)" : "rgba(139,245,198,0.45)"}`,
            }}
          >
            {isMock ? "mock" : "live"}
          </span>
          <span className={`relay-dot relay-dot--${relayStatus}`} aria-hidden="true" />
          <span className="relay-status mono">{STATUS_LABEL[relayStatus]}</span>
          <RelayField relayUrl={relayUrl} setRelayUrl={setRelayUrl} />
        </div>

        {/* verification proof, compact: a crest with the verified tally. The
            rejected alarm is hidden at zero and flares loud the moment a forged
            event is caught (the "you can't fake it" payoff). */}
        <div className="verify" aria-label="signature verification">
          <span className="verify-crest" title={`${num(ingested)} events signature-verified`}>
            <Seal size={14} />
            <span className="verify-count mono">{num(ingested)}</span>
          </span>
          {hasRejects && (
            <span className="verify-alarm" title="forged events caught and dropped, never rendered">
              <span className="verify-alarm-n mono">{num(rejected)}</span> rejected
            </span>
          )}
        </div>

        <LoginControl />
      </div>
    </header>
  );
}

