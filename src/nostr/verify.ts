// Signature verification + key formatting.
//
// The UI's core honesty guarantee: it renders ONLY events whose Schnorr signature
// verifies against the claimed node pubkey (BIP340), so it cannot show faked
// cluster state. Every event is run through `isVerified` before it is decoded or
// counted; failures are dropped and surfaced as a "rejected" count.

import { verifyEvent, type Event as NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";

/**
 * Verify an event's id-hash AND its Schnorr signature. nostr-tools `verifyEvent`
 * recomputes the event id from its fields and checks the signature against the
 * pubkey, so a tampered field or a forged sig both fail. Never throws.
 */
export function isVerified(ev: NostrEvent): boolean {
  try {
    return verifyEvent(ev);
  } catch {
    return false;
  }
}

/** Encode a hex pubkey as a bech32 npub (the node's stable cluster identity). */
export function toNpub(pubkeyHex: string): string {
  try {
    return npubEncode(pubkeyHex);
  } catch {
    return pubkeyHex;
  }
}

/** A compact npub for dense UI: `npub1abcde…wxyz`. */
export function shortNpub(npub: string): string {
  if (!npub.startsWith("npub1") || npub.length <= 18) return npub;
  return `${npub.slice(0, 11)}…${npub.slice(-5)}`;
}
