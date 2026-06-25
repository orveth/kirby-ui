// Tests for the auth core: key generation, import, and NIP-49 at-rest encryption.
// These are the key-safety-critical pure functions behind the login flow, so they
// are tested directly (the React hook + modal wire onto this verified core).

import { test, expect } from "bun:test";
import { getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";

import { generateAccount, encryptSecret, decryptSecret, importKey } from "./auth";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

test("generateAccount returns a valid keypair with a derivable npub", () => {
  const acct = generateAccount();

  // 32-byte secret key
  expect(acct.sk).toBeInstanceOf(Uint8Array);
  expect(acct.sk).toHaveLength(32);

  // pk is the 64-hex Schnorr pubkey derived from sk
  expect(acct.pk).toHaveLength(64);
  expect(acct.pk).toBe(getPublicKey(acct.sk));

  // npub is the bech32 encoding of that pubkey
  expect(acct.npub.startsWith("npub1")).toBe(true);
});

test("encryptSecret -> decryptSecret round-trips to the same key", () => {
  const { sk } = generateAccount();

  const ncryptsec = encryptSecret(sk, "correct horse battery staple");
  expect(ncryptsec.startsWith("ncryptsec1")).toBe(true);

  const recovered = decryptSecret(ncryptsec, "correct horse battery staple");
  expect(recovered).toEqual(sk);
});

test("decryptSecret throws on the wrong passphrase", () => {
  const { sk } = generateAccount();
  const ncryptsec = encryptSecret(sk, "right");

  expect(() => decryptSecret(ncryptsec, "wrong")).toThrow();
});

test("importKey accepts an nsec and recovers the matching account", () => {
  const orig = generateAccount();
  const nsec = nsecEncode(orig.sk);

  const acct = importKey(nsec);
  expect(acct.sk).toEqual(orig.sk);
  expect(acct.pk).toBe(orig.pk);
  expect(acct.npub).toBe(orig.npub);
});

test("importKey accepts a raw 64-char hex secret key", () => {
  const orig = generateAccount();
  const acct = importKey(toHex(orig.sk));
  expect(acct.pk).toBe(orig.pk);
});

test("importKey accepts an ncryptsec with its passphrase", () => {
  const orig = generateAccount();
  const ncryptsec = encryptSecret(orig.sk, "pw");

  const acct = importKey(ncryptsec, "pw");
  expect(acct.pk).toBe(orig.pk);
});

test("importKey throws on garbage input", () => {
  expect(() => importKey("not-a-key")).toThrow();
});

test("importKey throws on an npub (public key is not a secret)", () => {
  const { npub } = generateAccount();
  expect(() => importKey(npub)).toThrow();
});
