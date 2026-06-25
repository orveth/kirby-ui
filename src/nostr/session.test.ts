// Tests for session persistence. The rule under test: a secret key is NEVER stored
// in the clear — a local/imported session persists only its NIP-49 `ncryptsec`, and
// a NIP-07 session persists no key material at all. Storage is injected so these run
// without a browser.

import { test, expect } from "bun:test";
import { saveSession, loadSession, clearSession, type StoredSession } from "./session";

/** A minimal in-memory stand-in for the Web Storage API. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

test("a local session round-trips through storage (keeping the ncryptsec)", () => {
  const store = fakeStorage();
  const session: StoredSession = { method: "local", npub: "npub1abc", ncryptsec: "ncryptsec1xyz" };

  saveSession(store, session);
  expect(loadSession(store)).toEqual(session);
});

test("a NIP-07 session persists no key material", () => {
  const store = fakeStorage();
  saveSession(store, { method: "nip07", npub: "npub1ext" });

  const loaded = loadSession(store);
  expect(loaded).toEqual({ method: "nip07", npub: "npub1ext" });
  // the serialized blob must not carry any secret/ncryptsec field
  expect(JSON.stringify(loaded)).not.toContain("ncryptsec");
});

test("loadSession returns null when nothing is stored", () => {
  expect(loadSession(fakeStorage())).toBeNull();
});

test("loadSession returns null on corrupt data instead of throwing", () => {
  const store = fakeStorage();
  store.setItem("kirby.session", "{not json");
  expect(loadSession(store)).toBeNull();
});

test("clearSession removes the stored session", () => {
  const store = fakeStorage();
  saveSession(store, { method: "nip07", npub: "npub1ext" });
  clearSession(store);
  expect(loadSession(store)).toBeNull();
});
