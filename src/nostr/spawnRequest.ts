// The spawn-request builder: pure logic that turns operator input into the exact
// KIND 31003 (KIND_KIRBY_SPAWN_REQUEST) event template a Kirby node listens for,
// validates, and spawns an agent from. Publishing one of these to the relay is the
// control-plane "create agent" action — the relay is the transport, no backend.
//
// The wire shape mirrors the canonical Rust builder build_spawn_request_event and
// the SpawnRequest serde in kirby-node crates/kirby-node/src/spawn.rs; the agent_id
// rules mirror validate_agent_label in config.rs. The node re-validates everything
// (a signed event on a public relay is an attacker-controlled entry point), so this
// is a UX pre-flight, not the trust boundary — but it must match so a well-formed
// request from the UI is never bounced on shape.
//
// NOTE: 31003 is operator INTENT, not runtime truth, so it is deliberately NOT in
// kinds.ts / ALL_KINDS — the UI never subscribes to it. Confirmation that a spawn
// actually happened comes from the agent's born lifecycle (9100) + presence (10100)
// / state (31000), not from reading 31003 back.

import type { EventTemplate } from "./signer";

/** KIND_KIRBY_SPAWN_REQUEST: addressable (d = agent_id), one-shot per requester. */
export const KIND_SPAWN_REQUEST = 31003;

/** The per-spawn declarative funding ceiling (sats). Mirrors the node's clamp. */
export const MAX_SEED_SATS = 1_000_000;

/** Max byte length of the event content JSON (mirrors MAX_SPAWN_CONTENT_BYTES). */
export const MAX_SPAWN_CONTENT_BYTES = 8 * 1024;

export interface SpawnRequestInput {
  /** The agent identity label = the `d`/`a` tag = the treasury/lease key. */
  agentId: string;
  /** A pre-staged image the target node allowlists (default-deny on the node). */
  imageRef: string;
  /** Declarative seed treasury (sats); never a bearer token. */
  seedSats: number;
  /** Optional small, non-secret genome config (inert in the MVP node). */
  genomeConfig?: Record<string, unknown>;
  /** The signer's pubkey (hex). Omitted/"" => the node authorizes off the envelope
   *  (event.pubkey) alone; if set it MUST equal the signer or the node rejects it. */
  requesterPubkey?: string;
  /** created_at, unix seconds (injected so the builder stays pure/testable). */
  createdAt: number;
}

export type BuildResult =
  | { ok: true; template: EventTemplate }
  | { ok: false; error: string };

/** Validate an agent_id, mirroring validate_agent_label. Returns an error message
 *  or null if valid. */
export function validateAgentId(id: string): string | null {
  if (id.length === 0) return "agent id must be non-empty";
  if (id.length > 64) return `agent id must be ≤ 64 chars (got ${id.length})`;
  if (id === "." || id === "..") return "agent id must not be a path component";
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return "agent id may use only letters, digits, '-', '_', or '.'";
  }
  return null;
}

/** Validate the declarative seed amount. Returns an error message or null. */
export function validateSeedSats(sats: number): string | null {
  if (!Number.isInteger(sats)) return "seed must be a whole number of sats";
  if (sats <= 0) return "seed must be greater than 0";
  if (sats > MAX_SEED_SATS) return `seed must be ≤ ${MAX_SEED_SATS.toLocaleString()} sats`;
  return null;
}

/** Validate the image ref (non-empty here; the node enforces the allowlist). */
export function validateImageRef(ref: string): string | null {
  if (ref.trim().length === 0) return "image ref is required";
  return null;
}

/**
 * Build the signed-ready 31003 event template, or an error if any field is invalid
 * / the content exceeds the size cap. The content JSON field order matches the Rust
 * SpawnRequest serde exactly: agent_id, genome_config, image_ref, funding,
 * requester_pubkey.
 */
export function buildSpawnRequestTemplate(input: SpawnRequestInput): BuildResult {
  const idErr = validateAgentId(input.agentId);
  if (idErr) return { ok: false, error: idErr };

  const imgErr = validateImageRef(input.imageRef);
  if (imgErr) return { ok: false, error: imgErr };

  const seedErr = validateSeedSats(input.seedSats);
  if (seedErr) return { ok: false, error: seedErr };

  // Field order is load-bearing for parity with the Rust serde struct.
  const content = JSON.stringify({
    agent_id: input.agentId,
    genome_config: input.genomeConfig ?? {},
    image_ref: input.imageRef,
    funding: { seed_sats: input.seedSats },
    requester_pubkey: input.requesterPubkey ?? "",
  });

  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_SPAWN_CONTENT_BYTES) {
    return { ok: false, error: `request too large (${bytes} > ${MAX_SPAWN_CONTENT_BYTES} bytes)` };
  }

  return {
    ok: true,
    template: {
      kind: KIND_SPAWN_REQUEST,
      created_at: input.createdAt,
      tags: [
        ["d", input.agentId],
        ["t", "kirby"],
        ["a", input.agentId],
      ],
      content,
    },
  };
}
