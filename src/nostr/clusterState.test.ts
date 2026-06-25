// Tests for the agentTimeline selector: the per-agent event history the drill-down
// renders, derived purely from the global feed (no new stored state).

import { test, expect } from "bun:test";
import { KIND, type KirbyEvent } from "./kinds";
import { emptyCluster, clusterReducer, agentTimeline, fleetSummary, type ClusterState } from "./clusterState";

const fold = (s: ClusterState, ev: KirbyEvent) => clusterReducer(s, { type: "event", ev });

function stateEvent(agent_id: string, lifecycle: "running" | "dead", treasury: number, created_at: number): KirbyEvent {
  return {
    id: `st-${agent_id}-${created_at}`,
    pubkey: `pk-${agent_id}`,
    npub: "npub1x",
    created_at,
    node_id: "node-1",
    kind: KIND.AGENT_STATE,
    content: {
      agent_id,
      treasury_sats: treasury,
      runway_secs: 100,
      lifecycle,
      lease_holder_node: "node-1",
      lease_term: 1,
      backend: "vz",
    },
  };
}

function presenceEvent(node_id: string, pubkey: string, created_at: number): KirbyEvent {
  return {
    id: `pres-${node_id}-${created_at}`,
    pubkey,
    npub: "npub1n",
    created_at,
    node_id,
    kind: KIND.PRESENCE,
    content: { node_id, status: "alive" },
  };
}

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

test("fleetSummary aggregates agent lifecycle, treasury, and live nodes", () => {
  let s = emptyCluster;
  s = fold(s, stateEvent("a1", "running", 5000, 100));
  s = fold(s, stateEvent("a2", "running", 3000, 100));
  s = fold(s, stateEvent("a3", "dead", 0, 100));
  s = fold(s, presenceEvent("node-1", "np1", 100));
  s = fold(s, presenceEvent("node-2", "np2", 50)); // older beacon -> stale at now=120 (window 20)

  const sum = fleetSummary(s, 120, 20);
  expect(sum.agentsTotal).toBe(3);
  expect(sum.agentsRunning).toBe(2);
  expect(sum.agentsDead).toBe(1);
  expect(sum.treasurySats).toBe(8000); // running+dead treasuries summed (5000+3000+0)
  expect(sum.nodesTotal).toBe(2);
  expect(sum.nodesAlive).toBe(1); // node-2's beacon is stale
});

test("fleetSummary is all-zero on an empty cluster", () => {
  const sum = fleetSummary(emptyCluster, 0, 20);
  expect(sum.agentsTotal).toBe(0);
  expect(sum.treasurySats).toBe(0);
  expect(sum.nodesAlive).toBe(0);
});
