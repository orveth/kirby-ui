// Tests for decodeKirbyEvent's tag-synthesized fields — the values that ride a Nostr
// TAG rather than the content JSON and are lifted onto the decoded record. The 31000
// ["social", <hex>] binding is the load-bearing one for DMs: it names the agent's
// canonical DM key (the kind:10050 signer / NIP-17 recipient), and the DM panel's
// live-inbox resolver reads exactly this field. Absent tag -> null.

import { test, expect } from "bun:test";
import type { Event as NostrEvent } from "nostr-tools";
import { KIND, decodeKirbyEvent } from "./kinds";

/** A raw (pre-verify) 31000 Nostr event with the given tags + a valid content JSON. */
function agentStateRaw(tags: string[][]): NostrEvent {
  return {
    id: "e".repeat(64),
    pubkey: "f".repeat(64), // the Q (control) signer — deliberately NOT the social key
    created_at: 100,
    kind: KIND.AGENT_STATE,
    tags,
    content: JSON.stringify({
      agent_id: "agent-1",
      treasury_sats: 1000,
      runway_secs: 600,
      lifecycle: "running",
      lease_holder_node: null,
      lease_term: null,
      backend: "firecracker",
    }),
    sig: "0".repeat(128),
  };
}

const SOCIAL_HEX = "a".repeat(64);

test("decodeKirbyEvent lifts the 31000 ['social', hex] tag onto content.social", () => {
  const decoded = decodeKirbyEvent(agentStateRaw([["social", SOCIAL_HEX]]));
  expect(decoded?.kind).toBe(KIND.AGENT_STATE);
  if (decoded?.kind !== KIND.AGENT_STATE) throw new Error("expected AGENT_STATE");
  expect(decoded.content.social).toBe(SOCIAL_HEX);
  // The social key is read from the tag, NOT the Q signer pubkey (they differ by design).
  expect(decoded.content.social).not.toBe(decoded.pubkey);
  expect(decoded.content.agent_id).toBe("agent-1");
});

test("decodeKirbyEvent leaves content.social null when the tag is absent", () => {
  const decoded = decodeKirbyEvent(agentStateRaw([["node", "turtle"]]));
  if (decoded?.kind !== KIND.AGENT_STATE) throw new Error("expected AGENT_STATE");
  expect(decoded.content.social).toBeNull();
});
