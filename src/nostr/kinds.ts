// The Kirby cluster event-kind contract.
//
// This is the wire shape the UI consumes: each Kirby node's daemon signs and
// publishes Nostr events describing the cluster's observable state, and the UI
// (a Nostr client) subscribes to these kinds at the relay and renders them. The
// relay is the API. This module is the single source of truth for the kinds, the
// per-kind content JSON, and how a raw Nostr event decodes into a typed record.
//
// Locked with keeper:kirby-nostr (the publisher) 2026-06-19. Source of truth:
// plans/kirby-cluster-event-kinds-20260619.md. The content JSON is AUTHORITATIVE;
// tags (["t","kirby"], ["a",agent_id], ["node",node_id]) are convenience mirrors
// for relay-side filtering, so we read fields from content and treat tags as hints.

import type { Event as NostrEvent } from "nostr-tools";

/** The Kirby event kinds, by Nostr range semantics. */
export const KIND = {
  /** 1 regular text note: the agent's OWN public voice — a real kind:1 Nostr note
   *  the agent chose to post (the POST actuator, e.g. Chatter's "Hello world!").
   *  Content is PLAIN TEXT (not JSON); attributed to its agent via the ["a",agent_id]
   *  tag the publisher attaches to agent-scoped events. The wider Nostr world sees
   *  these as ordinary notes; we surface them in the feed as the agent's voice. */
  NOTE: 1,
  /** 10100 replaceable: node liveness heartbeat (slice-1, real). Latest-wins per node. */
  PRESENCE: 10100,
  /** 31000 addressable (d=agent_id): per-agent current state. The main dashboard tile. */
  AGENT_STATE: 31000,
  /** 21000 ephemeral: live cpu/mem/egress meter tick (not stored by the relay). */
  METER_TICK: 21000,
  /** 9100 regular/stored: lifecycle milestones (born / died). */
  LIFECYCLE: 9100,
  /** 9101 regular/stored: the money timeline (earn / spend). */
  LEDGER: 9101,
  /** 9102 regular/stored: failover evidence (kill a node, it survives). */
  FAILOVER: 9102,
  /** 9103 regular/stored: custody evidence (single-node spend refused / quorum signed). */
  CUSTODY: 9103,
} as const;

/** Every Kirby event kind, for the relay subscription filter. */
export const ALL_KINDS: number[] = Object.values(KIND);

/** The stored, append-only event-log kinds (the signed feed/timeline). The agent's
 *  own kind:1 notes (NOTE) ride this same timeline so its voice and its economic
 *  lifecycle interleave in one feed. */
export const FEED_KINDS: number[] = [
  KIND.NOTE,
  KIND.LIFECYCLE,
  KIND.LEDGER,
  KIND.FAILOVER,
  KIND.CUSTODY,
];

/** The discovery tag every Kirby event carries (per the doc). */
export const TAG_KIRBY: [string, string] = ["t", "kirby"];

// --- per-kind content shapes (the JSON in event.content) --------------------
// Fields the publisher sends `null`/absent until a kind is wired (e.g. treasury
// before C-4/C-5) are optional/nullable here; the UI renders those as "pending"
// rather than faking a value.

/** 10100 content. slice-1 ships {node_id, endpoint?, status}; the doc adds
 *  started_at/version. All beyond node_id+status are optional for tolerance. */
export interface PresenceContent {
  node_id: string;
  status: string; // "alive" in slice-1
  started_at?: number; // unix secs (doc); absent in slice-1
  version?: string; // absent in slice-1
  endpoint?: string; // slice-1 informational; absent in doc envelope
}

// 31000 emits running | dying | dead; "born" is surfaced from the 9100 lifecycle
// event (not 31000), and "unknown" is the no-state-yet display case.
export type Lifecycle = "born" | "running" | "dying" | "dead";
export type Backend = "firecracker" | "vz";

/** 31000 content. treasury_sats/runway_secs are null until C-4/C-5 wires the
 *  gateway debits to the cluster treasury -> UI shows "pending", not a fake. */
export interface AgentStateContent {
  agent_id: string;
  treasury_sats: number | null;
  runway_secs: number | null;
  lifecycle: Lifecycle;
  lease_holder_node: string | null; // null on the sovereign path (no Raft lease)
  lease_term: number | null; // null on the sovereign path
  backend: Backend;
}

export type Fidelity = "cgroup_exact" | "host_coarse";

/** 21000 content. The live needle. `fidelity` lets the UI show the VZ node's
 *  coarser metering honestly (host_coarse) vs the Linux nodes (cgroup_exact). */
export interface MeterTickContent {
  agent_id: string;
  cpu_pct: number;
  mem_mib: number;
  egress_bps: number;
  fidelity: Fidelity;
}

/** kind:1 "content". A real Nostr text note's content is the PLAIN-TEXT body, not
 *  JSON, so unlike the other kinds this is synthesized at decode time: `text` is the
 *  note body verbatim and `agent_id` is read from the ["a",agent_id] tag (the
 *  publisher's agent-scope tag), or null if the note carries no agent tag. */
export interface NoteContent {
  agent_id: string | null;
  text: string;
}

/** 9100 content. born -> ... -> DIED-when-broke. */
export interface LifecycleContent {
  agent_id: string;
  event: "born" | "died";
  treasury_sats: number;
  reason: "funded" | "broke";
}

/** 9101 content (pending C-4/C-5). The money timeline. */
export interface LedgerContent {
  agent_id: string;
  kind: "earn" | "spend";
  amount_sats: number;
  act: string;
  balance_after: number;
}

/** 9102 content (mechanism real C-3b; "no satoshi lost" pending C-4/C-5). */
export interface FailoverContent {
  agent_id: string;
  from_node: string;
  to_node: string;
  term: number;
  restored: "snapshot" | "app_checkpoint";
}

/** 9103 content (pending FROST/quorum). The "can't rug it" evidence. */
export interface CustodyContent {
  agent_id: string;
  event: "single_node_spend_refused" | "quorum_signed";
  detail: string;
}

// --- the decoded, typed event ----------------------------------------------

/** Relay-derived metadata attached to every decoded record. */
export interface EventMeta {
  /** The Nostr event id (hex). */
  id: string;
  /** The signing node's pubkey (hex) and npub (bech32) = its cluster identity. */
  pubkey: string;
  npub: string;
  /** created_at, unix seconds. For ticks/feed this is the observation time. */
  created_at: number;
  /** The node_id (from the ["node"|"node_id"] tag, else content). */
  node_id: string | null;
}

/** A decoded Kirby event: a discriminated union over `kind`. */
export type KirbyEvent =
  | (EventMeta & { kind: typeof KIND.NOTE; content: NoteContent })
  | (EventMeta & { kind: typeof KIND.PRESENCE; content: PresenceContent })
  | (EventMeta & { kind: typeof KIND.AGENT_STATE; content: AgentStateContent })
  | (EventMeta & { kind: typeof KIND.METER_TICK; content: MeterTickContent })
  | (EventMeta & { kind: typeof KIND.LIFECYCLE; content: LifecycleContent })
  | (EventMeta & { kind: typeof KIND.LEDGER; content: LedgerContent })
  | (EventMeta & { kind: typeof KIND.FAILOVER; content: FailoverContent })
  | (EventMeta & { kind: typeof KIND.CUSTODY; content: CustodyContent });

/** Read the first value of a tag by name (tags are `[name, value, ...]`). */
function tagValue(ev: NostrEvent, name: string): string | null {
  const t = ev.tags.find((t) => t[0] === name);
  return t && t.length > 1 ? t[1] : null;
}

/**
 * Decode a (signature-verified) Nostr event into a typed Kirby record, or null
 * if the kind is not a Kirby kind or the content JSON is malformed. Callers MUST
 * verify the signature before decoding (see verify.ts) - this function trusts
 * that the event is authentic and only validates the payload shape.
 */
export function decodeKirbyEvent(ev: NostrEvent): KirbyEvent | null {
  const meta: EventMeta = {
    id: ev.id,
    pubkey: ev.pubkey,
    npub: "", // filled by the caller (npubEncode lives in verify.ts to keep this pure)
    created_at: ev.created_at,
    node_id: tagValue(ev, "node") ?? tagValue(ev, "node_id"),
  };

  // kind:1 is a real Nostr text note: its content is the PLAIN-TEXT body, not JSON.
  // Decode it before the JSON.parse below (which would otherwise discard it). The
  // agent attribution rides the ["a",agent_id] tag the publisher already attaches
  // to agent-scoped events; it stays null if the note isn't agent-tagged.
  if (ev.kind === KIND.NOTE) {
    const text = ev.content.trim();
    if (text.length === 0) return null; // empty note -> nothing to surface
    const agent_id = tagValue(ev, "a");
    return { ...meta, kind: KIND.NOTE, content: { agent_id, text } };
  }

  let content: unknown;
  try {
    content = JSON.parse(ev.content);
  } catch {
    return null; // not JSON -> not a well-formed Kirby payload
  }
  if (typeof content !== "object" || content === null) return null;

  const c = content as Record<string, unknown>;
  switch (ev.kind) {
    case KIND.PRESENCE:
      if (typeof c.node_id !== "string") return null;
      return { ...meta, kind: KIND.PRESENCE, content: c as unknown as PresenceContent };
    case KIND.AGENT_STATE:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.AGENT_STATE, content: c as unknown as AgentStateContent };
    case KIND.METER_TICK:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.METER_TICK, content: c as unknown as MeterTickContent };
    case KIND.LIFECYCLE:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.LIFECYCLE, content: c as unknown as LifecycleContent };
    case KIND.LEDGER:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.LEDGER, content: c as unknown as LedgerContent };
    case KIND.FAILOVER:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.FAILOVER, content: c as unknown as FailoverContent };
    case KIND.CUSTODY:
      if (typeof c.agent_id !== "string") return null;
      return { ...meta, kind: KIND.CUSTODY, content: c as unknown as CustodyContent };
    default:
      return null; // not a Kirby kind
  }
}

/** Human label for a kind (for the feed). */
export function kindLabel(kind: number): string {
  switch (kind) {
    case KIND.NOTE: return "note";
    case KIND.PRESENCE: return "presence";
    case KIND.AGENT_STATE: return "agent-state";
    case KIND.METER_TICK: return "meter";
    case KIND.LIFECYCLE: return "lifecycle";
    case KIND.LEDGER: return "ledger";
    case KIND.FAILOVER: return "failover";
    case KIND.CUSTODY: return "custody";
    default: return `kind-${kind}`;
  }
}
