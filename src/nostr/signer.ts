// The Signer abstraction.
//
// A session signs operator commands through one of two custody models: a local
// in-memory secret key (generate/import login), or a NIP-07 browser extension
// (the keys never enter the app). Both expose the same `Signer` surface so the
// command layer is agnostic to how a session holds its key.

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { Event as NostrEvent } from "nostr-tools";
import type { WindowNostr } from "nostr-tools/nip07";

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
  /** Sign a template into a complete, verifiable Nostr event. */
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

/** True if a NIP-07 provider (`window.nostr`) is available on the given window. */
export function detectNip07(win: Window): boolean {
  return !!(win as Window & { nostr?: WindowNostr }).nostr;
}

/** A signer backed by a local 32-byte secret key (held in memory only). */
export function localSigner(sk: Uint8Array): Signer {
  return {
    pubkey: getPublicKey(sk),
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      return finalizeEvent(template, sk);
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
  return {
    pubkey,
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      return provider.signEvent(template as NostrEvent);
    },
  };
}
