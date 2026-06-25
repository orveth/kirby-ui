// The fleet overview: a compact band of cluster-wide vitals at the top of the
// dashboard — everything going on with Kirby at a glance. Pure derivation from the
// signed model (see fleetSummary); no extra data, no node dependency.

import type { ReactNode } from "react";
import type { FleetSummary } from "../nostr/clusterState";
import { num } from "./format";

export function FleetOverview({ summary }: { summary: FleetSummary }) {
  const { agentsRunning, agentsTotal, agentsDead, treasurySats, nodesAlive, nodesTotal, signed, posts } = summary;
  const allNodesUp = nodesTotal > 0 && nodesAlive === nodesTotal;

  return (
    <section className="fleet-overview" aria-label="fleet overview">
      <Stat
        label="agents running"
        value={num(agentsRunning)}
        sub={`of ${num(agentsTotal)}${agentsDead > 0 ? ` · ${num(agentsDead)} reaped` : ""}`}
        tone="alive"
      />
      <Stat label="fleet treasury" value={num(treasurySats)} sub="sats" tone="sig" />
      <Stat label="nodes alive" value={num(nodesAlive)} sub={`of ${num(nodesTotal)}`} tone={allNodesUp ? "alive" : "warn"} />
      <Stat label="voice" value={num(posts)} sub="posts" />
      <Stat label="signed events" value={num(signed)} />
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "alive" | "sig" | "warn" }) {
  return (
    <div className={`fleet-stat${tone ? ` fleet-stat--${tone}` : ""}`}>
      <span className="fleet-stat-value mono">{value}</span>
      <span className="fleet-stat-label">
        {label}
        {sub && <span className="fleet-stat-sub"> {sub}</span>}
      </span>
    </div>
  );
}
