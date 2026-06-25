// Tests for the agentTimeline selector: the per-agent event history the drill-down
// renders, derived purely from the global feed (no new stored state).

import { test, expect } from "bun:test";
import { KIND, type KirbyEvent } from "./kinds";
import { emptyCluster, agentTimeline, type ClusterState } from "./clusterState";

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
