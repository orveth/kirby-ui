// NIP-17 direct-message crypto for the operator identity.
//
// This is the operator-side analog of the agent's DM↔money quarantine: the only
// thing this module can do with the operator's key is build or open a DIRECT
// MESSAGE. It NEVER signs an arbitrary event. `buildDm` constructs a fixed
// structure (kind:14 rumor → kind:13 seal → kind:1059 gift wrap) from a recipient
// pubkey and a string; there is no path through it to frictionlessly sign a
// spawn/fund/arbitrary command. Those stay behind the gated ConfirmSign modal.
//
// ANTI-SPOOF (load-bearing). A NIP-17 gift wrap (kind:1059) is signed by a THROWAWAY
// ephemeral key, so its `pubkey` proves nothing about who sent the message. The real
// sender is the kind:13 SEAL's pubkey, authenticated by the NIP-44 MAC: only someone
// holding the seal key could have produced a ciphertext that decrypts under
// ECDH(me, seal.pubkey). The kind:14 rumor inside is UNSIGNED — its claimed `pubkey`
// is meaningless on its own. We therefore (a) verify the seal, (b) ENFORCE
// rumor.pubkey === seal.pubkey, and (c) key conversations off the seal pubkey. A
// forged wrapper whose inner rumor claims a different author is REJECTED, never
// threaded as the impersonated sender.
//
// Local-key vs NIP-07 custody differ ONLY in the two key-bound primitives
// (NIP-44 encrypt/decrypt + signing the seal); the wrap/unwrap logic — including the
// security check — is shared, so the two custody paths cannot drift apart on it.

import { finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44Encrypt } from "nostr-tools/nip44";
import type { Event as NostrEvent } from "nostr-tools";

/** The NIP-17 kinds. The frictionless DM path is scoped to exactly these. */
export const DM_KIND = {
  /** kind:14 — the chat message (a "rumor": unsigned, deniable). */
  RUMOR: 14,
  /** kind:13 — the seal: NIP-44(rumor) signed by the real sender. */
  SEAL: 13,
  /** kind:1059 — the gift wrap: NIP-44(seal) signed by a throwaway ephemeral key. */
  GIFT_WRAP: 1059,
  /** kind:10050 — a NIP-17 DM inbox-relay list; its signer is a DM-able npub. */
  INBOX: 10050,
} as const;

/** NIP-59 randomizes seal/wrap timestamps up to 2 days in the past (timing privacy). */
const TWO_DAYS = 2 * 24 * 60 * 60;

/** The authenticated inner message after opening a gift wrap. `sender` is the
 *  SEAL pubkey (verified) — never the wrapper's ephemeral pubkey. */
export interface DmRumor {
  /** The rumor's event id (NIP-01 hash) — the stable dedupe key for a message. */
  id: string;
  /** Hex pubkey of the verified author (=== the inner rumor's pubkey, enforced). */
  sender: string;
  /** Hex pubkey this message was addressed to (the rumor's first "p" tag), or null. */
  recipient: string | null;
  /** The real message time (the rumor's created_at, NOT the randomized wrap time). */
  created_at: number;
  /** The message body. */
  text: string;
}

/** What `buildDm` returns: the inner message (for an instant local echo that the
 *  relay-echoed self-copy then dedupes against) plus the gift wraps to publish. */
export interface BuiltDm {
  rumor: DmRumor;
  /** [wrap addressed to the agent, wrap addressed to ourselves]. Publishing the
   *  self-copy makes our sent side recoverable from the relay alone (no optimistic-
   *  only state that a reload would lose). Both decrypt to the SAME inner rumor. */
  wraps: NostrEvent[];
}

/** A kind:13 seal template, signed as the operator (local key or NIP-07). */
export interface SealTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** Encrypt NIP-44 from the operator to `peerPubkey`. */
export type Nip44Encrypt = (peerPubkey: string, plaintext: string) => Promise<string>;
/** Decrypt NIP-44 addressed to the operator from `peerPubkey`. */
export type Nip44Decrypt = (peerPubkey: string, ciphertext: string) => Promise<string>;
/** Sign a kind:13 seal as the operator. */
export type SealSigner = (template: SealTemplate) => Promise<NostrEvent>;

function nowSec(): number {
  return Math.round(Date.now() / 1000);
}
function randomPastNow(): number {
  return Math.round(nowSec() - Math.random() * TWO_DAYS);
}
function firstPTag(tags: string[][]): string | null {
  const t = tags.find((tag) => tag[0] === "p");
  return t && t.length > 1 ? t[1] : null;
}

/** The fields of a NIP-01 unsigned event we hash to derive a rumor id. */
interface RumorFields {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** Build the kind:14 rumor (unsigned) from the operator to the agent. */
function buildRumorFields(senderPubkey: string, agentPubkey: string, message: string): RumorFields {
  return {
    pubkey: senderPubkey,
    created_at: nowSec(),
    kind: DM_KIND.RUMOR,
    tags: [["p", agentPubkey]],
    content: message,
  };
}

/** Seal a rumor to `recipient` (kind:13, signed by the operator) and gift-wrap it
 *  (kind:1059, signed by a throwaway ephemeral key). The two custody models supply
 *  `encrypt`/`sealSign`; everything else is identical. */
async function sealAndWrap(
  rumor: RumorFields & { id: string },
  recipient: string,
  encrypt: Nip44Encrypt,
  sealSign: SealSigner,
): Promise<NostrEvent> {
  const sealContent = await encrypt(recipient, JSON.stringify(rumor));
  const seal = await sealSign({
    kind: DM_KIND.SEAL,
    created_at: randomPastNow(),
    tags: [],
    content: sealContent,
  });

  // The wrap layer is sender-anonymous: a fresh ephemeral key signs it and the
  // NIP-44 is ephemeral→recipient, so the wrapper leaks nothing about the operator.
  const ephemeral = generateSecretKey();
  const wrapContent = nip44Encrypt(JSON.stringify(seal), getConversationKey(ephemeral, recipient));
  return finalizeEvent(
    {
      kind: DM_KIND.GIFT_WRAP,
      created_at: randomPastNow(),
      tags: [["p", recipient]],
      content: wrapContent,
    },
    ephemeral,
  );
}

/** Build a NIP-17 DM to `agentPubkey` carrying `message`, plus a self-addressed copy. */
export async function buildDm(
  senderPubkey: string,
  agentPubkey: string,
  message: string,
  encrypt: Nip44Encrypt,
  sealSign: SealSigner,
): Promise<BuiltDm> {
  const fields = buildRumorFields(senderPubkey, agentPubkey, message);
  const id = getEventHash(fields);
  const rumor = { ...fields, id };

  const wrapForAgent = await sealAndWrap(rumor, agentPubkey, encrypt, sealSign);
  const wrapForSelf = await sealAndWrap(rumor, senderPubkey, encrypt, sealSign);

  return {
    rumor: { id, sender: senderPubkey, recipient: agentPubkey, created_at: fields.created_at, text: message },
    wraps: [wrapForAgent, wrapForSelf],
  };
}

function isEventLike(v: unknown): v is NostrEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.kind === "number" &&
    typeof e.pubkey === "string" &&
    typeof e.content === "string" &&
    typeof e.created_at === "number" &&
    typeof e.id === "string" &&
    typeof e.sig === "string" &&
    Array.isArray(e.tags)
  );
}

/**
 * Open a gift wrap addressed to the operator into its authenticated inner message.
 * Throws if the wrap is malformed, the seal fails verification, or — THE anti-spoof
 * gate — the unsigned rumor claims an author other than the seal's pubkey.
 */
export async function openDm(
  giftWrap: NostrEvent,
  decrypt: Nip44Decrypt,
): Promise<DmRumor> {
  if (giftWrap.kind !== DM_KIND.GIFT_WRAP) throw new Error("not a gift wrap");

  // 1) Unwrap (ephemeral→me) to recover the seal.
  const seal: unknown = JSON.parse(await decrypt(giftWrap.pubkey, giftWrap.content));
  if (!isEventLike(seal) || seal.kind !== DM_KIND.SEAL) throw new Error("malformed seal");

  // 2) The seal is a real signed event; its signature must verify (defense in depth —
  //    the NIP-44 MAC in step 3 is the primary authenticator of seal.pubkey).
  if (!verifyEvent(seal)) throw new Error("seal signature invalid");

  // 3) Unseal (sender→me) to recover the rumor. A successful decrypt here PROVES the
  //    sender holds seal.pubkey's secret key (no one else could form this ciphertext).
  const rumor: unknown = JSON.parse(await decrypt(seal.pubkey, seal.content));
  if (typeof rumor !== "object" || rumor === null) throw new Error("malformed rumor");
  const r = rumor as Record<string, unknown>;
  if (r.kind !== DM_KIND.RUMOR || typeof r.content !== "string" || typeof r.pubkey !== "string") {
    throw new Error("malformed rumor");
  }

  // 4) THE gate: the unsigned rumor's claimed author MUST equal the seal pubkey, or a
  //    sealer could impersonate anyone. We key the conversation off seal.pubkey.
  if (r.pubkey !== seal.pubkey) throw new Error("rumor/seal pubkey mismatch (spoofed sender)");

  const created_at = typeof r.created_at === "number" ? r.created_at : nowSec();
  const tags = Array.isArray(r.tags) ? (r.tags as string[][]) : [];
  // Recompute the id from the verified fields (don't trust an injected id).
  const id = getEventHash({ pubkey: seal.pubkey, created_at, kind: DM_KIND.RUMOR, tags, content: r.content });

  return { id, sender: seal.pubkey, recipient: firstPTag(tags), created_at, text: r.content };
}
