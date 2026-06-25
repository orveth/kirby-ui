// Tests for the pure feed-filter logic: the kind+agent predicate and the kind
// toggle (which must never leave an empty kind set — an empty feed reads as
// "nothing happened", which would be dishonest).

import { test, expect } from "bun:test";
import { KIND, FEED_KINDS, type KirbyEvent } from "../nostr/kinds";
import { filterFeed, toggleKind } from "./feedFilter";

function ev(id: string, kind: number, agent_id: string): KirbyEvent {
  // shape varies by kind, but every feed kind carries agent_id — enough for filtering
  return {
    id,
    pubkey: "0".repeat(64),
    npub: "npub1x",
    created_at: 1,
    node_id: null,
    kind,
    content: { agent_id },
  } as unknown as KirbyEvent;
}

const sample: KirbyEvent[] = [
  ev("a", KIND.LIFECYCLE, "kirby-1"),
  ev("b", KIND.LEDGER, "kirby-1"),
  ev("c", KIND.CUSTODY, "kirby-2"),
];

test("filterFeed keeps only active kinds", () => {
  const out = filterFeed(sample, new Set([KIND.LIFECYCLE]), null);
  expect(out.map((e) => e.id)).toEqual(["a"]);
});

test("filterFeed ANDs kind against agent", () => {
  const out = filterFeed(sample, new Set(FEED_KINDS), "kirby-1");
  expect(out.map((e) => e.id)).toEqual(["a", "b"]);
});

test("filterFeed with all kinds and no agent returns everything", () => {
  expect(filterFeed(sample, new Set(FEED_KINDS), null)).toHaveLength(3);
});

test("toggleKind removes an active kind", () => {
  const next = toggleKind(new Set(FEED_KINDS), KIND.LEDGER);
  expect(next.has(KIND.LEDGER)).toBe(false);
  expect(next.has(KIND.LIFECYCLE)).toBe(true);
});

test("toggleKind re-adds an inactive kind", () => {
  const next = toggleKind(new Set([KIND.LIFECYCLE]), KIND.CUSTODY);
  expect(next.has(KIND.CUSTODY)).toBe(true);
});

test("toggling off the last active kind resets to all (never empty)", () => {
  const next = toggleKind(new Set([KIND.LIFECYCLE]), KIND.LIFECYCLE);
  expect([...next].sort()).toEqual([...FEED_KINDS].sort());
});
