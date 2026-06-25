// The per-agent dashboard: one card per agent (keyed by failover-stable agent_id)
// from the 31000 state. This is the "earn or die" centerpiece — treasury is shown
// big. Where the publisher sends null (treasury/runway are pending until C-4/C-5
// wires gateway debits to the cluster treasury), we render an honest "pending"
// chip, never a fabricated number. A dead agent reads visibly reaped.

import { useState } from "react";
import type { AgentView } from "../nostr/clusterState";
import { agentBackend, displayLifecycle, leaseHolder } from "../nostr/clusterState";
import { num, dur } from "./format";
import { Panel } from "./Panel";
import { Kirby } from "./Kirby";
import { kirbyMood } from "./kirbyMood";
import { LIFECYCLE_COPY, MOOD_COPY, RunwayBar, Field, Pending } from "./agentFields";

interface AgentDashboardProps {
  agents: Record<string, AgentView>;
  now: number;
  /** Open the drill-down for an agent (click / Enter / Space on its card). */
  onSelect?: (agentId: string) => void;
  /** The starred agent_ids (the personal "watching" set). */
  watched?: Set<string>;
  /** Toggle an agent in/out of the watchlist. */
  onToggleWatch?: (agentId: string) => void;
}

export function AgentDashboard({ agents, onSelect, watched, onToggleWatch }: AgentDashboardProps) {
  const [watchingOnly, setWatchingOnly] = useState(false);
  const all = Object.values(agents).sort((a, b) => a.agent_id.localeCompare(b.agent_id));
  const watchCount = watched ? all.filter((a) => watched.has(a.agent_id)).length : 0;
  const list = watchingOnly && watched ? all.filter((a) => watched.has(a.agent_id)) : all;

  const meta =
    all.length === 0 ? undefined : watchCount > 0 ? (
      <button
        type="button"
        className={`watch-toggle${watchingOnly ? " watch-toggle--on" : ""}`}
        aria-pressed={watchingOnly}
        onClick={() => setWatchingOnly((v) => !v)}
      >
        ★ watching {num(watchCount)}
      </button>
    ) : (
      `${all.length} tracked`
    );

  return (
    <Panel title="agents" sub="current state · kind 31000" meta={meta}>
      {all.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no agents yet — fund one to bring it to life
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no watched agents in view — star an agent to follow it
        </div>
      ) : (
        <div className="agent-grid">
          {list.map((agent) => (
            <AgentCard
              key={agent.agent_id}
              agent={agent}
              onSelect={onSelect}
              watched={watched?.has(agent.agent_id) ?? false}
              onToggleWatch={onToggleWatch}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function AgentCard({
  agent,
  onSelect,
  watched,
  onToggleWatch,
}: {
  agent: AgentView;
  onSelect?: (agentId: string) => void;
  watched: boolean;
  onToggleWatch?: (agentId: string) => void;
}) {
  const life = displayLifecycle(agent);
  const dead = life === "dead";
  const backend = agentBackend(agent);
  const holder = leaseHolder(agent);
  const treasury = agent.state?.treasury_sats ?? null;
  const runway = agent.state?.runway_secs ?? null;
  const term = agent.state?.lease_term ?? null;
  // Sovereign (single-agent, no-Raft) path: 31000 sends a null lease holder/term.
  // Render it as "sovereign" rather than a pending/failover line.
  const sovereign = agent.state != null && agent.state.lease_holder_node == null;
  // The mascot's expression is a pure function of the real signed state.
  const mood = kirbyMood(agent);

  const open = onSelect ? () => onSelect(agent.agent_id) : undefined;

  return (
    <article
      className={`agent-card agent-card--${life}${dead ? " agent-card--dead" : ""}${open ? " agent-card--clickable" : ""}`}
      {...(open
        ? {
            role: "button",
            tabIndex: 0,
            onClick: open,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            },
          }
        : {})}
    >
      <header className="agent-card-head">
        <span className="agent-id mono">{agent.agent_id}</span>
        <span className="agent-card-head-right">
          <span className={`pill pill--${life}`}>{LIFECYCLE_COPY[life]}</span>
          {onToggleWatch && (
            <button
              type="button"
              className={`agent-star${watched ? " agent-star--on" : ""}`}
              aria-pressed={watched}
              title={watched ? "unfollow" : "follow this agent"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch(agent.agent_id);
              }}
            >
              {watched ? "★" : "☆"}
            </button>
          )}
        </span>
      </header>

      {/* THE HERO — a Kirby whose face reflects this agent's real economic state */}
      <div className="agent-hero">
        <Kirby mood={mood} active={life === "running"} />
        <span className={`agent-mood-label agent-mood-label--${mood}`}>{MOOD_COPY[mood]}</span>
      </div>

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
          {sovereign ? (
            <span className="badge mono">sovereign</span>
          ) : holder == null ? (
            <Pending />
          ) : (
            <span className="mono">{holder}</span>
          )}
        </Field>
        <Field k="lease term">
          {sovereign ? (
            <span className="mono">—</span>
          ) : term == null ? (
            <Pending />
          ) : (
            <span className="mono">term {num(term)}</span>
          )}
        </Field>
      </div>
    </article>
  );
}
