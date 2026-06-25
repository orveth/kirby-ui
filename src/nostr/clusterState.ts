// The in-memory model the UI renders, plus the pure reducer that folds verified
// Kirby events into it. Kept framework-free and pure so it is trivially testable
// and so high-frequency meter ticks do not entangle with React internals.
//
// Liveness (node stale/dead, meter idle) is NOT stored here - it is a function of
// `now` computed at render time from the stored `lastSeen`/`at` timestamps, so a
// node "dies" on the clock without needing a state mutation on a timer.

import {
  KIND,
  type AgentStateContent,
  type Backend,
  type Fidelity,
  type KirbyEvent,
  type Lifecycle,
} from "./kinds";

/** A node as seen via its 10100 presence beacon (latest-wins per pubkey). */
export interface NodeView {
  pubkey: string;
  npub: string;
  node_id: string | null;
  status: string;
  /** created_at of the latest beacon = last-seen unix secs. */
  lastSeen: number;
  startedAt?: number;
  version?: string;
  endpoint?: string;
}

/** A per-agent view: the 31000 state (if seen) + lifecycle hint from 9100. */
export interface AgentView {
  agent_id: string;
  /** The latest 31000 content, or null until one is published ("pending"). */
  state: AgentStateContent | null;
  /** created_at of the stored 31000 state. 31000 is addressable per (pubkey,d),
   *  so across failover two NODE keys may both publish for one agent_id; we keep
   *  the freshest created_at across pubkeys. Distinct from `lastUpdate` (which any
   *  agent-scoped event bumps) so a later meter tick can't drop a newer 31000. */
  stateAt: number;
  /** Lifecycle hint from the most recent 9100 (used when no 31000 yet). */
  lastLifecycleEvent: "born" | "died" | null;
  /** node_id this agent was last associated with (best-effort; prefer the lease
   *  holder from 31000 via `leaseHolder()`). The agent_id is failover-stable; the
   *  publishing node changes on failover, so never key an agent by pubkey. */
  node_id: string | null;
  firstSeen: number;
  lastUpdate: number;
}

/** The latest 21000 meter tick for an agent (ephemeral; live-only). */
export interface MeterView {
  agent_id: string;
  cpu_pct: number;
  mem_mib: number;
  egress_bps: number;
  fidelity: Fidelity;
  /** created_at of the tick. */
  at: number;
}

/** The cluster model. Maps keyed for latest-wins upserts; feed is newest-first. */
export interface ClusterState {
  nodes: Record<string, NodeView>; // key: pubkey
  agents: Record<string, AgentView>; // key: agent_id
  meters: Record<string, MeterView>; // key: agent_id
  /** signer pubkey -> agent_id, learned from agent-scoped events (31000/21000/9100/...).
   *  Used to attribute a kind:1 NOTE to its agent WITHOUT a tag: the same key that signs
   *  an agent's presence/state also signs that agent's notes (pre-FROST the node key signs
   *  both; post-FROST the agent's Q signs both), so the note's signer resolves the agent.
   *  Latest-wins per pubkey: across failover a node key may host a new agent, and the most
   *  recent agent-scoped event from a key reflects the agent it is currently signing for. */
  pubkeyAgents: Record<string, { agent_id: string; at: number }>; // key: pubkey
  feed: KirbyEvent[]; // 9100-9103, newest first, capped
  /** Total verified Kirby events folded in (a liveness counter for the stream). */
  ingested: number;
  /** Events whose signature FAILED verification (proof the UI rejects fakes). */
  rejected: number;
  /** Verified events that did not decode to a known Kirby payload. */
  malformed: number;
}

export const emptyCluster: ClusterState = {
  nodes: {},
  agents: {},
  meters: {},
  pubkeyAgents: {},
  feed: [],
  ingested: 0,
  rejected: 0,
  malformed: 0,
};

/** Cap on the rendered feed length (newest kept). */
const FEED_CAP = 300;

export type ClusterAction =
  | { type: "event"; ev: KirbyEvent }
  | { type: "rejected" }
  | { type: "malformed" }
  | { type: "reset" };

/** Ensure an agent entry exists, returning the (possibly new) map. */
function touchAgent(
  agents: Record<string, AgentView>,
  agent_id: string,
  now: number,
  node_id: string | null,
): Record<string, AgentView> {
  const existing = agents[agent_id];
  if (existing) {
    if (node_id && existing.node_id !== node_id) {
      return { ...agents, [agent_id]: { ...existing, node_id, lastUpdate: now } };
    }
    return agents;
  }
  return {
    ...agents,
    [agent_id]: {
      agent_id,
      state: null,
      stateAt: 0,
      lastLifecycleEvent: null,
      node_id,
      firstSeen: now,
      lastUpdate: now,
    },
  };
}

/** Learn (signer pubkey -> agent_id) from an agent-scoped event, latest-wins per
 *  pubkey. This is what lets a tag-less kind:1 NOTE be attributed to its agent: the
 *  invariant (verified against the real publisher) is that the same key signing an
 *  agent's presence/state/lifecycle also signs that agent's notes. */
function learnPubkeyAgent(
  index: Record<string, { agent_id: string; at: number }>,
  pubkey: string,
  agent_id: string,
  at: number,
): Record<string, { agent_id: string; at: number }> {
  const prev = index[pubkey];
  if (prev && prev.at >= at) return index;
  return { ...index, [pubkey]: { agent_id, at } };
}

/** The pure reducer: fold one verified+decoded Kirby event into the cluster. */
export function clusterReducer(state: ClusterState, action: ClusterAction): ClusterState {
  switch (action.type) {
    case "reset":
      return emptyCluster;
    case "rejected":
      return { ...state, rejected: state.rejected + 1 };
    case "malformed":
      return { ...state, malformed: state.malformed + 1 };
    case "event":
      return { ...foldEvent(state, action.ev), ingested: state.ingested + 1 };
    default:
      return state;
  }
}

function foldEvent(state: ClusterState, ev: KirbyEvent): ClusterState {
  switch (ev.kind) {
    case KIND.PRESENCE: {
      const prev = state.nodes[ev.pubkey];
      // latest-wins: ignore an older or equal beacon (replaceable re-delivery).
      if (prev && prev.lastSeen >= ev.created_at) return state;
      const node: NodeView = {
        pubkey: ev.pubkey,
        npub: ev.npub,
        node_id: ev.content.node_id ?? ev.node_id,
        status: ev.content.status,
        lastSeen: ev.created_at,
        startedAt: ev.content.started_at,
        version: ev.content.version,
        endpoint: ev.content.endpoint,
      };
      return { ...state, nodes: { ...state.nodes, [ev.pubkey]: node } };
    }

    case KIND.AGENT_STATE: {
      const id = ev.content.agent_id;
      const agents = touchAgent(state.agents, id, ev.created_at, ev.content.lease_holder_node ?? ev.node_id);
      // The signer of a 31000 is the node currently running `id`; bind its key -> agent_id.
      const pubkeyAgents = learnPubkeyAgent(state.pubkeyAgents, ev.pubkey, id, ev.created_at);
      state = { ...state, pubkeyAgents };
      const prev = agents[id];
      // 31000 is addressable per (pubkey, d=agent_id); across failover two NODE
      // keys may both publish for one agent_id. Keep the freshest created_at
      // across pubkeys (gate on stateAt, NOT lastUpdate which ticks also bump),
      // and trust the event's lease_holder_node for the current holder.
      if (prev.stateAt >= ev.created_at) return { ...state, agents };
      const updated: AgentView = {
        ...prev,
        state: ev.content,
        stateAt: ev.created_at,
        node_id: ev.content.lease_holder_node ?? prev.node_id,
        lastUpdate: Math.max(prev.lastUpdate, ev.created_at),
      };
      return { ...state, agents: { ...agents, [id]: updated } };
    }

    case KIND.METER_TICK: {
      const id = ev.content.agent_id;
      const agents = touchAgent(state.agents, id, ev.created_at, ev.node_id);
      // The signer of a meter tick is the node running `id`; bind its key -> agent_id.
      const pubkeyAgents = learnPubkeyAgent(state.pubkeyAgents, ev.pubkey, id, ev.created_at);
      state = { ...state, pubkeyAgents };
      const prevMeter = state.meters[id];
      if (prevMeter && prevMeter.at > ev.created_at) return { ...state, agents };
      const meter: MeterView = {
        agent_id: id,
        cpu_pct: ev.content.cpu_pct,
        mem_mib: ev.content.mem_mib,
        egress_bps: ev.content.egress_bps,
        fidelity: ev.content.fidelity,
        at: ev.created_at,
      };
      return { ...state, agents, meters: { ...state.meters, [id]: meter } };
    }

    // The stored, append-only event-log kinds -> the signed feed. kind:1 NOTE (the
    // agent's own public voice) rides this same timeline so the feed shows the
    // agent's actual words, not just its economic lifecycle.
    case KIND.NOTE:
    case KIND.LIFECYCLE:
    case KIND.LEDGER:
    case KIND.FAILOVER:
    case KIND.CUSTODY: {
      // dedupe by event id (stored kinds are re-delivered on resubscribe).
      if (state.feed.some((e) => e.id === ev.id)) return state;

      // A kind:1 NOTE carries NO reliable agent tag on real data (the publisher
      // rejects tags so the signed event matches the at-most-once request). Resolve
      // its agent_id by: (1) the ["a"] tag if decode found one, else (2) the signer
      // pubkey in the learned index, else (3) null -> the bare-npub fallback. Then
      // rewrite the event's content so the feed renders the resolved attribution.
      let feedEv = ev;
      if (ev.kind === KIND.NOTE) {
        const resolved = ev.content.agent_id ?? state.pubkeyAgents[ev.pubkey]?.agent_id ?? null;
        if (resolved !== ev.content.agent_id) {
          feedEv = { ...ev, content: { ...ev.content, agent_id: resolved } };
        }
      }

      // agent_id is present on every JSON agent-scoped kind; for those, learn the
      // signer-pubkey -> agent_id binding (the same key that signs a NOTE) and touch
      // the agent map. For a NOTE we only touch the agent map when the id resolved.
      const agentId =
        feedEv.kind === KIND.NOTE
          ? (feedEv.content.agent_id ?? undefined)
          : "agent_id" in feedEv.content
            ? (feedEv.content.agent_id as string | null) ?? undefined
            : undefined;

      let agents = state.agents;
      let pubkeyAgents = state.pubkeyAgents;
      if (agentId) {
        agents = touchAgent(agents, agentId, ev.created_at, ev.node_id);
        if (feedEv.kind === KIND.LIFECYCLE) {
          const prev = agents[agentId];
          agents = {
            ...agents,
            [agentId]: { ...prev, lastLifecycleEvent: feedEv.content.event, lastUpdate: ev.created_at },
          };
        }
        // A NOTE doesn't reliably carry agent_id, so it never teaches the index
        // (that would be circular); the JSON agent-scoped kinds do.
        if (feedEv.kind !== KIND.NOTE) {
          pubkeyAgents = learnPubkeyAgent(pubkeyAgents, ev.pubkey, agentId, ev.created_at);
        }
      }
      const feed = [feedEv, ...state.feed].slice(0, FEED_CAP);
      return { ...state, agents, pubkeyAgents, feed };
    }

    default:
      return state;
  }
}

// --- render-time selectors (liveness as a function of `now`) ----------------

export type Liveness = "alive" | "stale";

/** A node is alive if its last beacon is within the stale window, else stale (=dead). */
export function nodeLiveness(node: NodeView, now: number, staleWindowSecs: number): Liveness {
  return now - node.lastSeen <= staleWindowSecs ? "alive" : "stale";
}

/** A meter is "live" if a tick arrived within the idle window, else no-signal. */
export function meterIsLive(meter: MeterView, now: number, idleWindowSecs: number): boolean {
  return now - meter.at <= idleWindowSecs;
}

/** The lifecycle to display for an agent: 31000 if present, else 9100 hint. */
export function displayLifecycle(agent: AgentView): Lifecycle | "unknown" {
  if (agent.state) return agent.state.lifecycle;
  if (agent.lastLifecycleEvent === "died") return "dead";
  if (agent.lastLifecycleEvent === "born") return "born";
  return "unknown";
}

/** The agent's backend, or null if not yet known (pending 31000). */
export function agentBackend(agent: AgentView): Backend | null {
  return agent.state?.backend ?? null;
}

/** The node currently holding this agent's lease (authoritative from 31000,
 *  else the best-effort node_id seen on agent-scoped events). */
export function leaseHolder(agent: AgentView): string | null {
  return agent.state?.lease_holder_node ?? agent.node_id;
}

/** This agent's signed events from the live feed (newest-first, like `feed`).
 *  Bounded by the global feed cap — it is the recent window, not full history.
 *  Pure render-time derivation; no per-agent index is stored. */
export function agentTimeline(state: ClusterState, agentId: string): KirbyEvent[] {
  return state.feed.filter(
    (e) => "agent_id" in e.content && e.content.agent_id === agentId,
  );
}

/** Cluster-wide rollup for the fleet-overview band — pure derivation over the
 *  current model + render clock (so node liveness is computed against `now`). */
export interface FleetSummary {
  agentsTotal: number;
  agentsRunning: number;
  agentsDead: number;
  /** Sum of known agent treasuries (sats). Agents with no 31000 yet contribute 0. */
  treasurySats: number;
  nodesTotal: number;
  nodesAlive: number;
  /** Signed feed events held, and agent posts held (the voice). */
  signed: number;
  posts: number;
}

export function fleetSummary(state: ClusterState, now: number, staleWindowSecs: number): FleetSummary {
  const agents = Object.values(state.agents);
  let agentsRunning = 0;
  let agentsDead = 0;
  let treasurySats = 0;
  for (const a of agents) {
    const life = displayLifecycle(a);
    if (life === "running") agentsRunning++;
    else if (life === "dead") agentsDead++;
    treasurySats += a.state?.treasury_sats ?? 0;
  }
  const nodes = Object.values(state.nodes);
  const nodesAlive = nodes.filter((n) => nodeLiveness(n, now, staleWindowSecs) === "alive").length;

  // notes (the agent voice) ride the signed feed as kind:1 — count them out of it.
  const posts = state.feed.reduce((n, e) => (e.kind === KIND.NOTE ? n + 1 : n), 0);

  return {
    agentsTotal: agents.length,
    agentsRunning,
    agentsDead,
    treasurySats,
    nodesTotal: nodes.length,
    nodesAlive,
    signed: state.feed.length,
    posts,
  };
}
