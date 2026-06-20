// The per-agent dashboard: one card per agent (keyed by failover-stable agent_id)
// from the 31000 state. This is the "earn or die" centerpiece — treasury is shown
// big. Where the publisher sends null (treasury/runway are pending until C-4/C-5
// wires gateway debits to the cluster treasury), we render an honest "pending"
// chip, never a fabricated number. A dead agent reads visibly reaped.

import type { ReactNode } from "react";
import type { AgentView } from "../nostr/clusterState";
import { agentBackend, displayLifecycle, leaseHolder } from "../nostr/clusterState";
import type { Lifecycle } from "../nostr/kinds";
import { num, dur } from "./format";
import { Panel } from "./Panel";

interface AgentDashboardProps {
  agents: Record<string, AgentView>;
  now: number;
}

export function AgentDashboard({ agents }: AgentDashboardProps) {
  const list = Object.values(agents).sort((a, b) => a.agent_id.localeCompare(b.agent_id));

  return (
    <Panel
      title="agents"
      sub="current state · kind 31000"
      meta={list.length > 0 ? `${list.length} tracked` : undefined}
    >
      {list.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no agents yet — fund one to bring it to life
        </div>
      ) : (
        <div className="agent-grid">
          {list.map((agent) => (
            <AgentCard key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Lifecycle -> display copy. The data layer never emits invalid values; the
 *  default is just exhaustiveness insurance. */
const LIFECYCLE_COPY: Record<Lifecycle | "unknown", string> = {
  born: "born",
  running: "running",
  halting: "halting",
  dead: "dead · reaped",
  unknown: "pending",
};

function AgentCard({ agent }: { agent: AgentView }) {
  const life = displayLifecycle(agent);
  const dead = life === "dead";
  const backend = agentBackend(agent);
  const holder = leaseHolder(agent);
  const treasury = agent.state?.treasury_sats ?? null;
  const runway = agent.state?.runway_secs ?? null;
  const term = agent.state?.lease_term ?? null;

  return (
    <article className={`agent-card agent-card--${life}${dead ? " agent-card--dead" : ""}`}>
      <header className="agent-card-head">
        <span className="agent-id mono">{agent.agent_id}</span>
        <span className={`pill pill--${life}`}>{LIFECYCLE_COPY[life]}</span>
      </header>

      {/* the treasury hero — the metabolic balance */}
      <div className="treasury">
        <span className="treasury-label">treasury</span>
        {treasury == null ? (
          <Pending note="pending C-4/C-5" big />
        ) : (
          <>
            <span className="treasury-value mono">
              {num(treasury)}
              <span className="treasury-unit">sats</span>
            </span>
            <RunwayBar treasury={treasury} runway={runway} dead={dead} />
          </>
        )}
      </div>

      <div className="agent-meta">
        <Field k="runway">{runway == null ? <Pending /> : <span className="mono">{dur(runway)}</span>}</Field>
        <Field k="backend">
          {backend == null ? <Pending /> : <span className={`badge badge--${backend} mono`}>{backend}</span>}
        </Field>
        <Field k="lease holder">
          {holder == null ? <Pending /> : <span className="mono">{holder}</span>}
        </Field>
        <Field k="lease term">
          {term == null ? <Pending /> : <span className="mono">term {num(term)}</span>}
        </Field>
      </div>
    </article>
  );
}

/** A normalized runway bar. We can't know an absolute max runway, so the bar is a
 *  log-scaled fill that reads "lots / some / nearly broke" rather than a precise
 *  ratio — honest about being a vibe, not a claim. Empty + red when dead. */
function RunwayBar({ treasury, runway, dead }: { treasury: number; runway: number | null; dead: boolean }) {
  // Prefer runway seconds if present, else fall back to treasury magnitude.
  const basis = runway ?? treasury;
  const pct = dead ? 0 : Math.max(2, Math.min(100, (Math.log10(Math.max(1, basis)) / 5) * 100));
  return (
    <div className="runway" aria-hidden="true">
      <div
        className={`runway-fill${dead ? " runway-fill--dead" : pct < 28 ? " runway-fill--low" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-k">{k}</span>
      <span className="field-v">{children}</span>
    </div>
  );
}

/** The dim-amber honesty chip shown wherever the publisher hasn't wired a value. */
function Pending({ note, big }: { note?: string; big?: boolean }) {
  return (
    <span className={`pending${big ? " pending--big" : ""}`} title={note ?? "not yet wired by the cluster"}>
      pending{note && <span className="pending-note">{note}</span>}
    </span>
  );
}
