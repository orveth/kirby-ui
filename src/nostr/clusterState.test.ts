// Tests for the agentTimeline selector: the per-agent event history the drill-down
// renders, derived purely from the global feed (no new stored state).

import { test, expect } from "bun:test";
import { KIND, type Lifecycle, type KirbyEvent } from "./kinds";
import {
  emptyCluster,
  agentTimeline,
  visibleNodes,
  liveDmTargets,
  clusterReducer,
  type ClusterState,
} from "./clusterState";
import { toNpub } from "./verify";

/** Build a minimal feed event (lifecycle/ledger) carrying an agent_id. */
function feedEvent(id: string, agent_id: string, created_at: number): KirbyEvent {
  return {
    id,
    pubkey: "0".repeat(64),
    npub: "npub1test",
    created_at,
    node_id: "node-1",
    kind: KIND.LIFECYCLE,
    content: { agent_id, event: "born", treasury_sats: 1000, reason: "funded" },
  };
}

function withFeed(feed: KirbyEvent[]): ClusterState {
  return { ...emptyCluster, feed };
}

test("agentTimeline returns only events for the requested agent", () => {
  const state = withFeed([
    feedEvent("a", "kirby-1", 30),
    feedEvent("b", "kirby-2", 20),
    feedEvent("c", "kirby-1", 10),
  ]);

  const timeline = agentTimeline(state, "kirby-1");
  expect(timeline.map((e) => e.id)).toEqual(["a", "c"]);
});

test("agentTimeline preserves the feed's newest-first order", () => {
  const state = withFeed([
    feedEvent("new", "kirby-1", 30),
    feedEvent("old", "kirby-1", 10),
  ]);

  expect(agentTimeline(state, "kirby-1").map((e) => e.id)).toEqual(["new", "old"]);
});

test("agentTimeline returns an empty array for an unknown agent", () => {
  const state = withFeed([feedEvent("a", "kirby-1", 30)]);
  expect(agentTimeline(state, "kirby-404")).toEqual([]);
});

// --- visibleNodes (the node-grid filter: node-emitters only, GONE nodes dropped) -----

const NODE_KEY = "1".repeat(64);
const AGENT_KEY = "2".repeat(64);

/** A 10100 presence beacon (the relay keys nodes by signer pubkey). */
function presenceEvent(pubkey: string, node_id: string, created_at: number): KirbyEvent {
  return {
    id: `pres-${pubkey}-${created_at}`,
    pubkey,
    npub: `npub1${pubkey.slice(0, 8)}`,
    created_at,
    node_id,
    kind: KIND.PRESENCE,
    content: { node_id, status: "alive" },
  };
}

/** A 31000 agent-state signed by `pubkey` — this is what teaches `pubkeyAgents` that the
 *  signing key belongs to an agent (a real node key never signs an agent-scoped event).
 *  `social`/`lifecycle` are overridable so the DM-target tests can vary the binding and the
 *  lifecycle; they default to the live/no-social steady state the visibleNodes tests want. */
function agentStateEvent(
  pubkey: string,
  agent_id: string,
  created_at: number,
  opts: { social?: string | null; lifecycle?: Lifecycle } = {},
): KirbyEvent {
  return {
    id: `state-${pubkey}-${created_at}`,
    pubkey,
    npub: `npub1${pubkey.slice(0, 8)}`,
    created_at,
    node_id: null,
    kind: KIND.AGENT_STATE,
    content: {
      agent_id,
      treasury_sats: 1000,
      runway_secs: 600,
      lifecycle: opts.lifecycle ?? "running",
      lease_holder_node: null,
      lease_term: null,
      backend: "firecracker",
      social: opts.social ?? null,
    },
  };
}

/** Fold events into a cluster state through the real reducer. */
function fold(events: KirbyEvent[]): ClusterState {
  return events.reduce((s, ev) => clusterReducer(s, { type: "event", ev }), emptyCluster);
}

test("visibleNodes excludes a presence beacon from a known agent signer (U1)", () => {
  // A real node beacons presence; a pre-split agent has BOTH a lingering presence beacon
  // and an agent-state, so its key is learned as an agent and must not show as a node.
  const state = fold([
    presenceEvent(NODE_KEY, "turtle", 100),
    presenceEvent(AGENT_KEY, "turtle", 100),
    agentStateEvent(AGENT_KEY, "agent-1", 100),
  ]);
  // both beacons land in the raw nodes map...
  expect(Object.keys(state.nodes).sort()).toEqual([NODE_KEY, AGENT_KEY].sort());
  // ...but only the real node survives the agent filter.
  expect(visibleNodes(state, 100, 600).map((n) => n.pubkey)).toEqual([NODE_KEY]);
});

test("visibleNodes drops a node silent beyond the gone cutoff (U3)", () => {
  const state = fold([presenceEvent(NODE_KEY, "turtle", 100)]);
  // exactly at the cutoff: still shown (even though long stale).
  expect(visibleNodes(state, 100 + 600, 600).map((n) => n.pubkey)).toEqual([NODE_KEY]);
  // one second past the cutoff: gone.
  expect(visibleNodes(state, 100 + 601, 600)).toEqual([]);
});

test("visibleNodes keeps a live node and isn't fooled by a post-split agent", () => {
  // The steady state after the split: the agent emits agent-state but NO presence.
  const state = fold([
    presenceEvent(NODE_KEY, "turtle", 100),
    agentStateEvent(AGENT_KEY, "agent-1", 100),
  ]);
  expect(visibleNodes(state, 110, 600).map((n) => n.node_id)).toEqual(["turtle"]);
});

// --- liveDmTargets (the DM-panel discovery filter: live agents' social bindings) ------
//
// The bug this closes: the DM panel listed EVERY kind:10050 inbox ever seen, so a dead
// run's stale inbox looked identical to a live one and a DM to it went nowhere. The fix
// surfaces only agents whose latest 31000 is fresh, not dead/dying, and carries a
// ["social"] hex (the canonical DM key) — resolved + labelled by agent_id.

const SOCIAL_HEX = "a".repeat(64); // a real 32-byte hex pubkey -> a real npub

test("liveDmTargets surfaces a live agent's social binding, labelled by agent_id", () => {
  const state = fold([
    agentStateEvent(AGENT_KEY, "agent-live", 100, { social: SOCIAL_HEX }),
  ]);
  const targets = liveDmTargets(state, 150, 600); // 50s old, well within the window
  expect(targets).toEqual([
    { agent_id: "agent-live", social: SOCIAL_HEX, npub: toNpub(SOCIAL_HEX) },
  ]);
  // the npub is the bech32 of the SOCIAL hex (the DM target), not the signer's.
  expect(targets[0].npub.startsWith("npub1")).toBe(true);
});

test("liveDmTargets drops an agent whose latest 31000 is stale (past the window)", () => {
  const state = fold([
    agentStateEvent(AGENT_KEY, "agent-stale", 100, { social: SOCIAL_HEX }),
  ]);
  // one second past the gone window (now - stateAt = 600, not < 600) -> gone.
  expect(liveDmTargets(state, 700, 600)).toEqual([]);
  // still within the window (599s old) -> present.
  expect(liveDmTargets(state, 699, 600).map((t) => t.agent_id)).toEqual(["agent-stale"]);
});

test("liveDmTargets drops a dead or dying agent even with a fresh social 31000", () => {
  const dead = fold([
    agentStateEvent(AGENT_KEY, "agent-dead", 100, { social: SOCIAL_HEX, lifecycle: "dead" }),
  ]);
  expect(liveDmTargets(dead, 150, 600)).toEqual([]);

  const dying = fold([
    agentStateEvent(AGENT_KEY, "agent-dying", 100, { social: SOCIAL_HEX, lifecycle: "dying" }),
  ]);
  expect(liveDmTargets(dying, 150, 600)).toEqual([]);
});

test("liveDmTargets drops a live agent with no social tag (no DM target to resolve)", () => {
  // A fresh, running 31000 that simply never carried a ["social"] binding: there is no
  // canonical DM key to offer, so it must not appear (this is the dead-inbox guard's
  // inverse — no binding pointing at an inbox means the inbox is never surfaced).
  const state = fold([
    agentStateEvent(AGENT_KEY, "agent-nosocial", 100, { social: null }),
  ]);
  expect(liveDmTargets(state, 150, 600)).toEqual([]);
});

test("liveDmTargets sorts by 31000 recency (freshest first)", () => {
  const OTHER_KEY = "3".repeat(64);
  const OTHER_SOCIAL = "b".repeat(64);
  const state = fold([
    agentStateEvent(AGENT_KEY, "agent-older", 100, { social: SOCIAL_HEX }),
    agentStateEvent(OTHER_KEY, "agent-newer", 200, { social: OTHER_SOCIAL }),
  ]);
  expect(liveDmTargets(state, 250, 600).map((t) => t.agent_id)).toEqual([
    "agent-newer",
    "agent-older",
  ]);
});
