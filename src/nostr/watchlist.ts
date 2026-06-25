// Watchlist persistence: the set of agent_ids the user stars to follow, kept in
// localStorage. Pure functions (storage injected) so they're testable headless;
// the React hook (useWatchlist) wraps these over window.localStorage.

import { useCallback, useState } from "react";

const WATCHLIST_KEY = "kirby.watchlist";

/** Load the starred agent_ids, or an empty set if absent/corrupt (never throws). */
export function loadWatchlist(storage: Storage): Set<string> {
  const raw = storage.getItem(WATCHLIST_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist the starred agent_ids. */
export function saveWatchlist(storage: Storage, watched: Set<string>): void {
  storage.setItem(WATCHLIST_KEY, JSON.stringify([...watched]));
}

/** Add or remove an agent_id, returning a new set. */
export function toggleWatch(watched: Set<string>, agentId: string): Set<string> {
  const next = new Set(watched);
  if (next.has(agentId)) next.delete(agentId);
  else next.add(agentId);
  return next;
}

export interface UseWatchlist {
  watched: Set<string>;
  isWatched: (agentId: string) => boolean;
  toggle: (agentId: string) => void;
}

/** React binding over the watchlist, persisting every change to localStorage. */
export function useWatchlist(): UseWatchlist {
  const [watched, setWatched] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadWatchlist(window.localStorage),
  );

  const toggle = useCallback((agentId: string) => {
    setWatched((prev) => {
      const next = toggleWatch(prev, agentId);
      if (typeof window !== "undefined") saveWatchlist(window.localStorage, next);
      return next;
    });
  }, []);

  const isWatched = useCallback((agentId: string) => watched.has(agentId), [watched]);

  return { watched, isWatched, toggle };
}
