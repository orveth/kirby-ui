// The React binding: connect to the Nostr relay, subscribe to every Kirby kind,
// verify each event's signature, decode it, and fold it into the cluster model.
//
// This is the whole "backend": there is none. The relay is the API. The hook owns
// the relay connection lifecycle (with auto-reconnect, so the kill/restart demo
// recovers on its own) and exposes the model + a render-time `now` clock so
// liveness (stale nodes, idle meters) is computed against the wall clock.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import type { Event as NostrEvent } from "nostr-tools";

import { ALL_KINDS, KIND, decodeKirbyEvent } from "./kinds";
import { isVerified, toNpub } from "./verify";
import { clusterReducer, emptyCluster, type ClusterState } from "./clusterState";

export type RelayStatus = "connecting" | "connected" | "error";

export interface UseCluster {
  state: ClusterState;
  /** Unix seconds, ticking every second; drives render-time liveness. */
  now: number;
  relayStatus: RelayStatus;
  relayUrl: string;
  setRelayUrl: (url: string) => void;
  /** Dev/demo: feed a FORGED (bad-sig) event into the verify path to prove the
   *  UI rejects it (it never reaches the model; the rejected counter ticks). */
  injectForged: () => void;
  reset: () => void;
}

// Build-time default relay: deploys set VITE_RELAY_URL (e.g. the public demo
// relay) so the served URL "just works" with no query string; dev falls back to
// localhost. Always overridable at runtime via ?relay= or the header input.
export const DEFAULT_RELAY: string =
  import.meta.env.VITE_RELAY_URL ?? "ws://127.0.0.1:7777";

/** Read the initial relay URL from `?relay=`, then localStorage, then default. */
function initialRelay(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("relay");
    if (q) return q;
    const saved = window.localStorage.getItem("kirby.relay");
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_RELAY;
}

export function useCluster(): UseCluster {
  const [state, dispatch] = useReducer(clusterReducer, emptyCluster);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("connecting");
  const [relayUrl, setRelayUrlState] = useState<string>(initialRelay);

  // The render-time clock: tick once a second so a node can "go stale" without a
  // new event arriving.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Connect + subscribe whenever the relay URL changes. The pool self-verifies
  // signatures (invalid events go to oninvalidevent, never to onevent); we also
  // re-verify in onevent as defense-in-depth and for the forged-injection path.
  useEffect(() => {
    dispatch({ type: "reset" });
    setRelayStatus("connecting");

    const pool = new SimplePool();
    pool.onRelayConnectionSuccess = () => setRelayStatus("connected");
    pool.onRelayConnectionFailure = () => setRelayStatus("error");

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: ALL_KINDS },
      {
        onevent(ev: NostrEvent) {
          if (!isVerified(ev)) {
            dispatch({ type: "rejected" });
            return;
          }
          const decoded = decodeKirbyEvent(ev);
          if (!decoded) {
            dispatch({ type: "malformed" });
            return;
          }
          decoded.npub = toNpub(ev.pubkey);
          dispatch({ type: "event", ev: decoded });
        },
        oninvalidevent() {
          // The pool's own signature check rejected this one.
          dispatch({ type: "rejected" });
        },
        onclose() {
          // A relay closed the subscription; the pool will attempt to reconnect.
          setRelayStatus("error");
        },
      },
    );

    return () => {
      sub.close();
      pool.destroy();
    };
  }, [relayUrl]);

  const setRelayUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem("kirby.relay", trimmed);
    } catch {
      /* ignore */
    }
    setRelayUrlState(trimmed);
  }, []);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  // Build a forged event (valid-looking Kirby presence payload, BOGUS signature)
  // and run it through the exact verification path the relay stream uses. It must
  // be rejected: this is the live proof the UI cannot render unsigned/faked state.
  const injectForged = useCallback(() => {
    const forged: NostrEvent = {
      id: "f".repeat(64),
      pubkey: "0".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND.PRESENCE,
      tags: [
        ["t", "kirby"],
        ["node", "forged-node"],
      ],
      content: JSON.stringify({ node_id: "forged-node", status: "alive" }),
      sig: "0".repeat(128),
    };
    if (!isVerified(forged)) {
      dispatch({ type: "rejected" });
    } else {
      // Should never happen (a zero sig cannot verify); fold it if it somehow did.
      const decoded = decodeKirbyEvent(forged);
      if (decoded) {
        decoded.npub = toNpub(forged.pubkey);
        dispatch({ type: "event", ev: decoded });
      }
    }
  }, []);

  // Keep a stable ref to the latest relayUrl for consumers that need it without
  // re-subscribing (none yet, but cheap insurance).
  const relayRef = useRef(relayUrl);
  relayRef.current = relayUrl;

  return { state, now, relayStatus, relayUrl, setRelayUrl, injectForged, reset };
}
