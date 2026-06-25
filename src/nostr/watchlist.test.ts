// Tests for the watchlist persistence: a set of agent_ids the user stars to follow,
// kept in localStorage. Pure functions over an injected Storage so they run headless.

import { test, expect } from "bun:test";
import { loadWatchlist, saveWatchlist, toggleWatch } from "./watchlist";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

test("toggleWatch adds then removes an agent", () => {
  let s = toggleWatch(new Set<string>(), "kirby-1");
  expect(s.has("kirby-1")).toBe(true);
  s = toggleWatch(s, "kirby-1");
  expect(s.has("kirby-1")).toBe(false);
});

test("save then load round-trips the watchlist", () => {
  const store = fakeStorage();
  saveWatchlist(store, new Set(["kirby-1", "kirby-2"]));
  expect([...loadWatchlist(store)].sort()).toEqual(["kirby-1", "kirby-2"]);
});

test("loadWatchlist returns an empty set when nothing is stored", () => {
  expect(loadWatchlist(fakeStorage()).size).toBe(0);
});

test("loadWatchlist tolerates corrupt data", () => {
  const store = fakeStorage();
  store.setItem("kirby.watchlist", "{not json");
  expect(loadWatchlist(store).size).toBe(0);
});
