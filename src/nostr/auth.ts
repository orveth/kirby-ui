// The auth core: key generation, import, and NIP-49 at-rest encryption.
//
// This is the key-safety-critical layer behind login. It deals only in pure
// values (no React, no DOM, no storage) so it can be tested directly and reused
// by the `useNostrAuth` hook. Secret keys are `Uint8Array` and never serialized
// to plaintext here — persistence is always via NIP-49 `ncryptsec`.

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode as nip19Decode, npubEncode } from "nostr-tools/nip19";
import { encrypt as nip49Encrypt, decrypt as nip49Decrypt } from "nostr-tools/nip49";

/** scrypt cost for interactive login: ~100ms at LOG_N=16 (NIP-49 guidance). */
const NIP49_LOG_N = 16;

/** A logged-in identity backed by a local secret key (generate/import paths). */
export interface Account {
  /** The 32-byte secret key. In-memory only; never persisted in the clear. */
  sk: Uint8Array;
  /** The 64-hex Schnorr public key. */
  pk: string;
  /** The bech32 `npub1…` encoding of `pk`. */
  npub: string;
}

/** Generate a fresh keypair for a brand-new user (the "I'm new to Nostr" path). */
export function generateAccount(): Account {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { sk, pk, npub: npubEncode(pk) };
}

/**
 * Encrypt a secret key with a passphrase into a NIP-49 `ncryptsec1…` string. This
 * is the ONLY form a secret key may take at rest (e.g. localStorage): scrypt-derived
 * key + XChaCha20-Poly1305, so a plaintext nsec never touches disk.
 */
export function encryptSecret(sk: Uint8Array, passphrase: string): string {
  return nip49Encrypt(sk, passphrase, NIP49_LOG_N);
}

/**
 * Decrypt a NIP-49 `ncryptsec1…` back to the 32-byte secret key. Throws if the
 * passphrase is wrong or the input is malformed (the auth-tag check fails).
 */
export function decryptSecret(ncryptsec: string, passphrase: string): Uint8Array {
  return nip49Decrypt(ncryptsec, passphrase);
}

/** Parse a 64-char hex string into 32 bytes, or throw if it isn't valid hex. */
function hexToSecret(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("not a 32-byte hex key");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Import an existing secret key from any of the accepted forms and return the
 * derived account. Throws on anything that is not a usable secret key (including
 * an `npub`, which is a *public* key). For an `ncryptsec1…` a passphrase is required.
 *
 *  - `nsec1…`      → bech32 secret key
 *  - `ncryptsec1…` → NIP-49 encrypted key (needs `passphrase`)
 *  - 64-char hex   → raw secret key
 */
export function importKey(input: string, passphrase?: string): Account {
  const trimmed = input.trim();

  let sk: Uint8Array;
  if (trimmed.startsWith("ncryptsec1")) {
    if (!passphrase) throw new Error("passphrase required to import an ncryptsec");
    sk = decryptSecret(trimmed, passphrase);
  } else if (trimmed.startsWith("nsec1")) {
    const decoded = nip19Decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("not an nsec");
    sk = decoded.data;
  } else {
    sk = hexToSecret(trimmed); // throws if not 64-char hex (rejects npub, garbage)
  }

  const pk = getPublicKey(sk);
  return { sk, pk, npub: npubEncode(pk) };
}
