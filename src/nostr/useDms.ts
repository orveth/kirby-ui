// The DM React binding: a NIP-17 client on top of the operator identity.
//
// Mirrors useCluster's lifecycle (own the relay connection, fold events into a
// model) but for private messages instead of cluster state:
//   - subscribe to kind:1059 gift wraps addressed to the operator (#p = our pubkey),
//     open each one, and fold the seal-verified inner message into a per-peer thread;
//   - subscribe to kind:10050 inbox lists to DISCOVER DM-able npubs on the relay.
//
// Threads are keyed off the SEAL-verified sender (openDm enforces this), never the
// gift wrap's ephemeral pubkey. When we send, we also wrap a self-copy so our own
// side is recoverable from the relay; the optimistic echo dedupes against it by id.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { SimplePool } from "nostr-tools/pool";
import type { Event as NostrEvent } from "nostr-tools";

import { useNostrAuth } from "./useNostrAuth";
import { DM_KIND } from "./dm";
import { isVerified, toNpub } from "./verify";

/** One message in a thread. */
export interface DmMessage {
  /** The rumor id — the dedupe key (optimistic echo vs the relay-echoed self-copy). */
  id: string;
  /** True if WE (the operator) authored it; false if the agent did. */
  fromOperator: boolean;
  text: string;
  /** The real message time (rumor created_at), unix seconds. */
  created_at: number;
}

/** A conversation with one agent dm-pubkey. */
export interface DmThread {
  /** The agent's DM pubkey (hex) — the conversation key. */
  peer: string;
  npub: string;
  /** Messages oldest-first. */
  messages: DmMessage[];
  /** Newest message time in the thread. */
  lastActivity: number;
}

/** A DM-able identity discovered from a kind:10050 inbox-list on the relay. */
export interface DiscoveredInbox {
  /** The 10050 signer's pubkey (hex) — an npub that accepts NIP-17 DMs. */
  pubkey: string;
  npub: string;
  /** The relays the inbox advertises (NIP-17 "relay" tags). */
  relays: string[];
  /** When we last saw an inbox event from this pubkey, unix seconds. */
  seen_at: number;
}

export interface UseDms {
  /** Conversations, most-recently-active first. */
  threads: DmThread[];
  /** Discovered DM inboxes, most-recently-seen first. */
  inboxes: DiscoveredInbox[];
  /** Whether the current session can DM (false when logged out / no NIP-44). */
  canDm: boolean;
  /** Send a DM to `agentPubkey` (hex). Optimistically echoes, then publishes. */
  send: (agentPubkey: string, text: string) => Promise<void>;
  /** Count of gift wraps that failed to open (spoofed/malformed/not-for-us). */
  dropped: number;
}

interface StoredMessage extends DmMessage {
  peer: string;
}

interface DmState {
  byId: Record<string, StoredMessage>;
  inboxes: Record<string, DiscoveredInbox>;
  dropped: number;
}

type DmAction =
  | { type: "msg"; msg: StoredMessage }
  | { type: "inbox"; inbox: DiscoveredInbox }
  | { type: "dropped" }
  | { type: "reset" };

const emptyDms: DmState = { byId: {}, inboxes: {}, dropped: 0 };

function dmReducer(state: DmState, action: DmAction): DmState {
  switch (action.type) {
    case "msg": {
      if (state.byId[action.msg.id]) return state; // dedupe by rumor id
      return { ...state, byId: { ...state.byId, [action.msg.id]: action.msg } };
    }
    case "inbox": {
      const prev = state.inboxes[action.inbox.pubkey];
      if (prev && prev.seen_at >= action.inbox.seen_at) return state; // keep freshest
      return { ...state, inboxes: { ...state.inboxes, [action.inbox.pubkey]: action.inbox } };
    }
    case "dropped":
      return { ...state, dropped: state.dropped + 1 };
    case "reset":
      return emptyDms;
    default:
      return state;
  }
}

/** Read the NIP-17 "relay" tags off a kind:10050 inbox event. */
function inboxRelays(ev: NostrEvent): string[] {
  return ev.tags.filter((t) => t[0] === "relay" && t.length > 1).map((t) => t[1]);
}

export function useDms(relayUrl: string): UseDms {
  const { pubkey, canDm, buildDm, openDm } = useNostrAuth();
  const [state, dispatch] = useReducer(dmReducer, emptyDms);
  const poolRef = useRef<SimplePool | null>(null);
  const relayRef = useRef(relayUrl);
  relayRef.current = relayUrl;

  // Connect + subscribe whenever the relay or the operator identity changes. We can
  // only open DMs once authed (decryption needs the key), so a logged-out session
  // simply holds no pool and an empty model.
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!relayUrl || !pubkey) {
      poolRef.current = null;
      return;
    }

    const pool = new SimplePool();
    poolRef.current = pool;

    // Incoming gift wraps addressed to us — open each and thread it by seal sender.
    const dmSub = pool.subscribeMany(
      [relayUrl],
      { kinds: [DM_KIND.GIFT_WRAP], "#p": [pubkey] },
      {
        onevent(ev: NostrEvent) {
          openDm(ev)
            .then((rumor) => {
              const fromOperator = rumor.sender === pubkey;
              // For our own messages the peer is who we addressed (the rumor's "p"
              // tag); for an inbound message it's the verified sender.
              const peer = fromOperator ? rumor.recipient : rumor.sender;
              if (!peer) {
                dispatch({ type: "dropped" });
                return;
              }
              dispatch({
                type: "msg",
                msg: { id: rumor.id, peer, fromOperator, text: rumor.text, created_at: rumor.created_at },
              });
            })
            .catch(() => dispatch({ type: "dropped" }));
        },
      },
    );

    // Inbox lists — every kind:10050 signer is an npub that accepts NIP-17 DMs.
    const inboxSub = pool.subscribeMany(
      [relayUrl],
      { kinds: [DM_KIND.INBOX] },
      {
        onevent(ev: NostrEvent) {
          if (!isVerified(ev)) return;
          dispatch({
            type: "inbox",
            inbox: { pubkey: ev.pubkey, npub: toNpub(ev.pubkey), relays: inboxRelays(ev), seen_at: ev.created_at },
          });
        },
      },
    );

    return () => {
      dmSub.close();
      inboxSub.close();
      pool.destroy();
      poolRef.current = null;
    };
  }, [relayUrl, pubkey, openDm]);

  const send = useCallback(
    async (agentPubkey: string, text: string) => {
      const body = text.trim();
      if (!body) return;
      const { rumor, wraps } = await buildDm(agentPubkey, body);
      // Optimistic echo: show it instantly; the relay-echoed self-copy dedupes by id.
      dispatch({
        type: "msg",
        msg: { id: rumor.id, peer: agentPubkey, fromOperator: true, text: rumor.text, created_at: rumor.created_at },
      });
      const pool = poolRef.current;
      if (!pool) throw new Error("relay not connected");
      // Publish to the agent AND the self-copy; resolve once each lands on the relay.
      await Promise.all(wraps.map((w) => Promise.any(pool.publish([relayRef.current], w))));
    },
    [buildDm],
  );

  // Fold the flat message map into per-peer threads, sorted for display.
  const threads = useMemo<DmThread[]>(() => {
    const byPeer = new Map<string, DmMessage[]>();
    for (const m of Object.values(state.byId)) {
      const list = byPeer.get(m.peer) ?? [];
      list.push({ id: m.id, fromOperator: m.fromOperator, text: m.text, created_at: m.created_at });
      byPeer.set(m.peer, list);
    }
    const out: DmThread[] = [];
    for (const [peer, messages] of byPeer) {
      messages.sort((a, b) => a.created_at - b.created_at);
      out.push({ peer, npub: toNpub(peer), messages, lastActivity: messages[messages.length - 1]?.created_at ?? 0 });
    }
    out.sort((a, b) => b.lastActivity - a.lastActivity);
    return out;
  }, [state.byId]);

  const inboxes = useMemo<DiscoveredInbox[]>(
    () => Object.values(state.inboxes).sort((a, b) => b.seen_at - a.seen_at),
    [state.inboxes],
  );

  return { threads, inboxes, canDm, send, dropped: state.dropped };
}
