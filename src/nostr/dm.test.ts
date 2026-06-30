// NIP-17 DM crypto teeth. Run: `bun test src/nostr/dm.test.ts`.
//
// The load-bearing one is `rejects a wrapper whose rumor claims a different author
// than the seal`: the whole anti-spoof property of NIP-17 is that the sender is the
// SEAL pubkey, not the (unsigned) rumor's claim and not the wrapper's ephemeral key.

import { test, expect } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44Encrypt } from "nostr-tools/nip44";
import type { Event as NostrEvent } from "nostr-tools";

import { localSigner } from "./signer";
import { DM_KIND } from "./dm";

test("round-trip: agent recovers the message and the verified sender", async () => {
  const op = localSigner(generateSecretKey());
  const agent = localSigner(generateSecretKey());

  const { rumor, wraps } = await op.buildDm(agent.pubkey, "are you awake?");
  expect(wraps).toHaveLength(2); // [to agent, to self]

  // The agent opens the wrap addressed to it.
  const opened = await agent.openDm(wraps[0]);
  expect(opened.text).toBe("are you awake?");
  expect(opened.sender).toBe(op.pubkey); // sender = the seal pubkey, the operator
  expect(opened.recipient).toBe(agent.pubkey);
  expect(opened.id).toBe(rumor.id); // stable id → dedupe works
});

test("self-copy: the operator can read its own sent side from the relay", async () => {
  const op = localSigner(generateSecretKey());
  const agent = localSigner(generateSecretKey());

  const { rumor, wraps } = await op.buildDm(agent.pubkey, "hello there");
  const selfCopy = await op.openDm(wraps[1]);
  expect(selfCopy.text).toBe("hello there");
  expect(selfCopy.sender).toBe(op.pubkey); // we authored it
  expect(selfCopy.recipient).toBe(agent.pubkey); // addressed to the agent → threads there
  expect(selfCopy.id).toBe(rumor.id);
});

test("buildDm only ever emits DM kinds (no arbitrary-command bypass)", async () => {
  const op = localSigner(generateSecretKey());
  const agent = localSigner(generateSecretKey());
  const { wraps } = await op.buildDm(agent.pubkey, "x");
  // Every top-level event is a gift wrap; the inner layers are seal(13)/rumor(14),
  // proven by the round-trip test. The signature takes only (pubkey, message) — there
  // is no parameter through which a 31003 spawn/fund template could be signed.
  for (const w of wraps) expect(w.kind).toBe(DM_KIND.GIFT_WRAP);
});

test("rejects a wrapper whose rumor claims a different author than the seal (anti-spoof)", async () => {
  // The recipient/operator who will try to open the forged wrap.
  const victimOperator = localSigner(generateSecretKey());

  // The attacker legitimately seals to the operator, but stuffs the UNSIGNED rumor
  // with someone else's pubkey to impersonate them.
  const skAttacker = generateSecretKey();
  const pkAttacker = getPublicKey(skAttacker);
  const impersonatedPubkey = getPublicKey(generateSecretKey());

  const fakeRumor = {
    pubkey: impersonatedPubkey, // ← claims to be the victim, but the seal is the attacker's
    created_at: Math.round(Date.now() / 1000),
    kind: DM_KIND.RUMOR,
    tags: [["p", victimOperator.pubkey]],
    content: "trust me, I am someone you trust",
  };
  const rumorWithId = { ...fakeRumor, id: getEventHash(fakeRumor) };

  // Seal signed by the ATTACKER, encrypted attacker→operator.
  const sealContent = nip44Encrypt(JSON.stringify(rumorWithId), getConversationKey(skAttacker, victimOperator.pubkey));
  const seal = finalizeEvent(
    { kind: DM_KIND.SEAL, created_at: fakeRumor.created_at, tags: [], content: sealContent },
    skAttacker,
  );

  // Wrap with a throwaway ephemeral key, encrypted ephemeral→operator.
  const ephemeral = generateSecretKey();
  const wrapContent = nip44Encrypt(JSON.stringify(seal), getConversationKey(ephemeral, victimOperator.pubkey));
  const forgedWrap: NostrEvent = finalizeEvent(
    { kind: DM_KIND.GIFT_WRAP, created_at: fakeRumor.created_at, tags: [["p", victimOperator.pubkey]], content: wrapContent },
    ephemeral,
  );

  // The operator MUST reject it — it must never thread as the impersonated sender.
  await expect(victimOperator.openDm(forgedWrap)).rejects.toThrow(/spoof/i);
});

test("rejects a non-gift-wrap event", async () => {
  const op = localSigner(generateSecretKey());
  const notAWrap = finalizeEvent(
    { kind: 1, created_at: Math.round(Date.now() / 1000), tags: [], content: "a normal note" },
    generateSecretKey(),
  );
  await expect(op.openDm(notAWrap)).rejects.toThrow();
});
