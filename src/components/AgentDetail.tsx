// The agent drill-down: a modal that tells one agent's story — its current signed
// state plus the chronological timeline of its signed events (born → earn/spend →
// failover → custody → died), all derived from data the app already holds.
//
// Honesty: the timeline is the RECENT window (bounded by the global feed cap), not
// a complete lifetime history; every value comes from a verified event or shows a
// pending chip — nothing is fabricated. Reuses the .auth-overlay/.auth-modal shell
// and the shared FeedRow / agent-field helpers.

import { useEffect } from "react";
import type { AgentView } from "../nostr/clusterState";
import { agentBackend, displayLifecycle, leaseHolder } from "../nostr/clusterState";
import type { KirbyEvent } from "../nostr/kinds";
import { num, dur, ago } from "./format";
import { shortNpub } from "../nostr/verify";
import { Kirby } from "./Kirby";
import { kirbyMood } from "./kirbyMood";
import { Seal } from "./Seal";
import { FeedRow } from "./FeedRow";
import { LIFECYCLE_COPY, MOOD_COPY, RunwayBar, Field, Pending } from "./agentFields";

interface AgentDetailProps {
  agent: AgentView;
  /** This agent's signed events, newest-first (as `feed` is ordered). */
  timeline: KirbyEvent[];
  now: number;
  onClose: () => void;
}

export function AgentDetail({ agent, timeline, now, onClose }: AgentDetailProps) {
  // Escape closes (matches the relay-field / ConfirmSign keyboard convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const life = displayLifecycle(agent);
  const dead = life === "dead";
  const mood = kirbyMood(agent);
  const backend = agentBackend(agent);
  const holder = leaseHolder(agent);
  const treasury = agent.state?.treasury_sats ?? null;
  const runway = agent.state?.runway_secs ?? null;
  const term = agent.state?.lease_term ?? null;
  const sovereign = agent.state != null && agent.state.lease_holder_node == null;
  // The signer of this agent's most recent event = its current voice (the lease
  // holder). The agent_id is failover-stable; the signing node can change.
  const signerNpub = timeline[0]?.npub ?? null;
  // Story order: render oldest → newest so it reads born → … → died.
  const chrono = [...timeline].reverse();

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label={`agent ${agent.agent_id}`} onClick={onClose}>
      <div className="auth-modal detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <h2 className="mono">{agent.agent_id}</h2>
          <button type="button" className="auth-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="detail-top">
          <div className="detail-hero">
            <Kirby mood={mood} active={life === "running"} size={150} />
            <span className={`pill pill--${life}`}>{LIFECYCLE_COPY[life]}</span>
            <span className={`agent-mood-label agent-mood-label--${mood}`}>{MOOD_COPY[mood]}</span>
          </div>

          <div className="detail-state">
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
                {sovereign ? <span className="mono">—</span> : term == null ? <Pending /> : <span className="mono">term {num(term)}</span>}
              </Field>
              <Field k="seen since">
                <span className="mono">{ago(agent.firstSeen, now)}</span>
              </Field>
              <Field k="last update">
                <span className="mono">{ago(agent.lastUpdate, now)}</span>
              </Field>
              <Field k="current signer">
                {signerNpub == null ? (
                  <Pending />
                ) : (
                  <span className="detail-signer" title={`signed by ${signerNpub}`}>
                    <Seal size={11} title="signature verified" />
                    <span className="mono">{shortNpub(signerNpub)}</span>
                  </span>
                )}
              </Field>
            </div>
          </div>
        </div>

        <div className="detail-timeline">
          <div className="detail-timeline-head">
            <span className="panel-title">timeline</span>
            <span className="panel-sub mono">recent signed events · within the live feed window</span>
          </div>
          {chrono.length === 0 ? (
            <div className="empty">
              <span className="empty-pulse" aria-hidden="true" />
              no signed events for this agent in the live feed window yet
            </div>
          ) : (
            <ol className="feed">
              {chrono.map((ev) => (
                <FeedRow key={ev.id} ev={ev} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
