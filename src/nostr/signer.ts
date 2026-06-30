// The Signer abstraction.
//
// A session signs operator commands through one of two custody models: a local
// in-memory secret key (generate/import login), or a NIP-07 browser extension
// (the keys never enter the app). Both expose the same `Signer` surface so the
// command layer is agnostic to how a session holds its key.

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44Encrypt, decrypt as nip44Decrypt } from "nostr-tools/nip44";
import type { Event as NostrEvent } from "nostr-tools";
import type { WindowNostr } from "nostr-tools/nip07";

import { buildDm, openDm, type BuiltDm, type DmRumor, type Nip44Encrypt, type Nip44Decrypt } from "./dm";

/** An unsigned event ready to be signed (NIP-07's `signEvent` input shape). */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** A uniform signing surface over local-key and NIP-07 custody. */
export interface Signer {
  /** The 64-hex public key this signer signs as. */
  pubkey: string;
  /** Sign a template into a complete, verifiable Nostr event (the GATED command
   *  path — callers route this through the ConfirmSign modal). */
  signEvent(template: EventTemplate): Promise<NostrEvent>;
  /** Whether this signer can do NIP-17 DMs: always for a local key; for NIP-07 only
   *  if the extension exposes `nip44` (the key never leaves the extension). */
  canDm: boolean;
  /** Build a NIP-17 DM to `agentPubkey` (+ a self-copy). FRICTIONLESS and structurally
   *  scoped to DM kinds (14/13/1059) — it can never sign an arbitrary command. */
  buildDm(agentPubkey: string, message: string): Promise<BuiltDm>;
  /** Open a gift wrap addressed to us into its seal-verified inner message. */
  openDm(giftWrap: NostrEvent): Promise<DmRumor>;
}

/** True if a NIP-07 provider (`window.nostr`) is available on the given window. */
export function detectNip07(win: Window): boolean {
  return !!(win as Window & { nostr?: WindowNostr }).nostr;
}

/** A signer backed by a local 32-byte secret key (held in memory only). */
export function localSigner(sk: Uint8Array): Signer {
  const pubkey = getPublicKey(sk);
  // NIP-44 to/from a peer, derived from the local key. The secret never leaves here.
  const encrypt: Nip44Encrypt = async (peer, pt) => nip44Encrypt(pt, getConversationKey(sk, peer));
  const decrypt: Nip44Decrypt = async (peer, ct) => nip44Decrypt(ct, getConversationKey(sk, peer));
  return {
    pubkey,
    canDm: true,
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      return finalizeEvent(template, sk);
    },
    buildDm(agentPubkey, message) {
      return buildDm(pubkey, agentPubkey, message, encrypt, (tpl) => Promise.resolve(finalizeEvent(tpl, sk)));
    },
    openDm(giftWrap) {
      return openDm(giftWrap, decrypt);
    },
  };
}

/**
 * A signer that delegates to a NIP-07 extension on the given window. Reads the
 * pubkey once at construction (may prompt the extension). Throws if no provider
 * is present.
 */
export async function nip07Signer(win: Window): Promise<Signer> {
  const provider = (win as Window & { nostr?: WindowNostr }).nostr;
  if (!provider) throw new Error("no NIP-07 extension detected");
  const pubkey = await provider.getPublicKey();

  // DMs need the extension's NIP-44; not all extensions expose it. When absent we
  // report canDm=false so the UI steers the operator to a local key instead.
  const nip44 = provider.nip44;
  const noNip44 = (): never => {
    throw new Error("this NIP-07 extension does not support NIP-44 encryption");
  };
  const encrypt: Nip44Encrypt = nip44 ? (peer, pt) => nip44.encrypt(peer, pt) : async () => noNip44();
  const decrypt: Nip44Decrypt = nip44 ? (peer, ct) => nip44.decrypt(peer, ct) : async () => noNip44();

  return {
    pubkey,
    canDm: !!nip44,
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      return provider.signEvent(template);
    },
    buildDm(agentPubkey, message) {
      // The seal is signed by the extension (kind:13 only — never an arbitrary kind);
      // the ephemeral wrap is signed locally inside buildDm.
      return buildDm(pubkey, agentPubkey, message, encrypt, (tpl) => provider.signEvent(tpl));
    },
    openDm(giftWrap) {
      return openDm(giftWrap, decrypt);
    },
  };
}
