// Tests for the spawn-request builder: the pure logic that turns operator input
// into the exact KIND 31003 event template a Kirby node validates and spawns from.
// The wire shape MUST match the canonical Rust builder (build_spawn_request_event)
// + SpawnRequest serde in kirby-node crates/kirby-node/src/spawn.rs, and the
// agent_id validation MUST mirror validate_agent_label in config.rs.

import { test, expect } from "bun:test";
import {
  KIND_SPAWN_REQUEST,
  MAX_SEED_SATS,
  validateAgentId,
  validateSeedSats,
  validateImageRef,
  buildSpawnRequestTemplate,
} from "./spawnRequest";

// --- validateAgentId (mirrors validate_agent_label) -------------------------

test("validateAgentId rejects an empty id", () => {
  expect(validateAgentId("")).not.toBeNull();
});

test("validateAgentId rejects an id over 64 chars", () => {
  expect(validateAgentId("a".repeat(65))).not.toBeNull();
  expect(validateAgentId("a".repeat(64))).toBeNull();
});

test("validateAgentId rejects path components", () => {
  expect(validateAgentId(".")).not.toBeNull();
  expect(validateAgentId("..")).not.toBeNull();
});

test("validateAgentId rejects characters outside [A-Za-z0-9._-]", () => {
  expect(validateAgentId("bad/id")).not.toBeNull();
  expect(validateAgentId("has space")).not.toBeNull();
  expect(validateAgentId("emoji😀")).not.toBeNull();
});

test("validateAgentId accepts the allowed charset", () => {
  expect(validateAgentId("chatter-1")).toBeNull();
  expect(validateAgentId("agent_0.v2")).toBeNull();
});

// --- validateSeedSats -------------------------------------------------------

test("validateSeedSats rejects zero and negatives", () => {
  expect(validateSeedSats(0)).not.toBeNull();
  expect(validateSeedSats(-1)).not.toBeNull();
});

test("validateSeedSats rejects non-integers", () => {
  expect(validateSeedSats(1.5)).not.toBeNull();
  expect(validateSeedSats(Number.NaN)).not.toBeNull();
});

test("validateSeedSats rejects amounts over the ceiling", () => {
  expect(validateSeedSats(MAX_SEED_SATS + 1)).not.toBeNull();
  expect(validateSeedSats(MAX_SEED_SATS)).toBeNull();
});

test("validateSeedSats accepts a normal amount", () => {
  expect(validateSeedSats(50000)).toBeNull();
});

// --- validateImageRef -------------------------------------------------------

test("validateImageRef rejects an empty ref", () => {
  expect(validateImageRef("")).not.toBeNull();
  expect(validateImageRef("   ")).not.toBeNull();
});

test("validateImageRef accepts a non-empty ref", () => {
  expect(validateImageRef("kirby-demo:latest")).toBeNull();
});

// --- buildSpawnRequestTemplate (mirrors build_spawn_request_event) ----------

test("buildSpawnRequestTemplate produces the exact 31003 wire shape", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "chatter-1",
    imageRef: "kirby-demo:latest",
    seedSats: 50000,
    requesterPubkey: "ab12",
    createdAt: 1_700_000_000,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const { template } = res;

  expect(template.kind).toBe(KIND_SPAWN_REQUEST);
  expect(template.kind).toBe(31003);
  expect(template.created_at).toBe(1_700_000_000);
  // tags: ["d", id], ["t","kirby"], ["a", id] — in this order.
  expect(template.tags).toEqual([
    ["d", "chatter-1"],
    ["t", "kirby"],
    ["a", "chatter-1"],
  ]);
  // content: serde field order is agent_id, genome_config, image_ref, funding,
  // requester_pubkey. Lock the exact string so the wire format can't drift.
  expect(template.content).toBe(
    '{"agent_id":"chatter-1","genome_config":{},"image_ref":"kirby-demo:latest","funding":{"seed_sats":50000},"requester_pubkey":"ab12"}',
  );
});

test("buildSpawnRequestTemplate defaults genome_config to {} and requester_pubkey to empty", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "a1",
    imageRef: "img",
    seedSats: 1,
    createdAt: 1,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const content = JSON.parse(res.template.content);
  expect(content.genome_config).toEqual({});
  expect(content.requester_pubkey).toBe("");
});

test("buildSpawnRequestTemplate carries a small genome_config", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "a1",
    imageRef: "img",
    seedSats: 1,
    genomeConfig: { task: "chatter" },
    createdAt: 1,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(JSON.parse(res.template.content).genome_config).toEqual({ task: "chatter" });
});

test("buildSpawnRequestTemplate rejects an invalid agent_id", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "bad/id",
    imageRef: "img",
    seedSats: 1,
    createdAt: 1,
  });
  expect(res.ok).toBe(false);
});

test("buildSpawnRequestTemplate rejects bad funding", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "a1",
    imageRef: "img",
    seedSats: 0,
    createdAt: 1,
  });
  expect(res.ok).toBe(false);
});

test("buildSpawnRequestTemplate rejects an empty image_ref", () => {
  const res = buildSpawnRequestTemplate({
    agentId: "a1",
    imageRef: "",
    seedSats: 1,
    createdAt: 1,
  });
  expect(res.ok).toBe(false);
});

test("buildSpawnRequestTemplate rejects content over 8 KiB", () => {
  const big = { blob: "x".repeat(9000) };
  const res = buildSpawnRequestTemplate({
    agentId: "a1",
    imageRef: "img",
    seedSats: 1,
    genomeConfig: big,
    createdAt: 1,
  });
  expect(res.ok).toBe(false);
});
