// Tests for the Signer abstraction: a uniform sign surface over the two key
// custody models — a local in-memory key, and a NIP-07 browser extension. The UI
// publishes operator commands through whichever signer the session holds.

import { test, expect } from "bun:test";
import { verifyEvent } from "nostr-tools";

import { generateAccount } from "./auth";
import { localSigner, nip07Signer, detectNip07, type EventTemplate } from "./signer";

const template: EventTemplate = {
  kind: 1,
  created_at: 1_750_000_000,
  tags: [["t", "kirby"]],
  content: "hello fleet",
};

test("localSigner produces a fully-signed, verifiable event", async () => {
  const acct = generateAccount();
  const signer = localSigner(acct.sk);

  expect(signer.pubkey).toBe(acct.pk);

  const signed = await signer.signEvent(template);
  expect(signed.pubkey).toBe(acct.pk);
  expect(signed.sig).toHaveLength(128);
  expect(verifyEvent(signed)).toBe(true);
});

test("detectNip07 reflects whether window.nostr is present", () => {
  expect(detectNip07({} as Window)).toBe(false);
  expect(detectNip07({ nostr: {} } as unknown as Window)).toBe(true);
});

test("nip07Signer delegates signing to window.nostr", async () => {
  const acct = generateAccount();
  // a minimal fake NIP-07 provider that signs with a known local key
  const fakeWindow = {
    nostr: {
      async getPublicKey() {
        return acct.pk;
      },
      async signEvent(t: EventTemplate) {
        const { finalizeEvent } = await import("nostr-tools/pure");
        return finalizeEvent(t, acct.sk);
      },
    },
  } as unknown as Window;

  const signer = await nip07Signer(fakeWindow);
  expect(signer.pubkey).toBe(acct.pk);

  const signed = await signer.signEvent(template);
  expect(verifyEvent(signed)).toBe(true);
});

test("nip07Signer throws when no extension is present", async () => {
  await expect(nip07Signer({} as Window)).rejects.toThrow();
});
