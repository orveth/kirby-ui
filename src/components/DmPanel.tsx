// The DM panel: message an agent and watch the multi-turn conversation unfold.
//
// A NIP-17 chat client on the operator identity. The operator picks an agent's DM
// npub (typed in, or from the discovered kind:10050 inboxes on the relay), sends a
// gift-wrapped message, and reads the agent's gift-wrapped replies threaded by the
// SEAL-verified sender. A DM is quarantined on the agent side — it can only make the
// agent think and reply, never spend or post — so the operator can chat freely.

import { useEffect, useMemo, useRef, useState } from "react";
import { decode } from "nostr-tools/nip19";

import { useNostrAuth } from "../nostr/useNostrAuth";
import { useDms, type DmThread } from "../nostr/useDms";
import { shortNpub, toNpub } from "../nostr/verify";
import { clock } from "./format";

/** Accept either a bech32 `npub1…` or a 64-char hex pubkey; return hex, or null. */
function toHexPubkey(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  try {
    const d = decode(s);
    if (d.type === "npub") return d.data as string;
  } catch {
    /* not an npub */
  }
  return null;
}

export function DmPanel({ relayUrl }: { relayUrl: string }) {
  const { status, canDm, pubkey } = useNostrAuth();
  const { threads, inboxes, send } = useDms(relayUrl);

  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [newNpub, setNewNpub] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-open the most recently active conversation so a reply lands in view.
  useEffect(() => {
    if (!selectedPeer && threads.length > 0) setSelectedPeer(threads[0].peer);
  }, [selectedPeer, threads]);

  const selectedThread: DmThread | undefined = useMemo(
    () => threads.find((t) => t.peer === selectedPeer),
    [threads, selectedPeer],
  );

  // Discovered inboxes we don't already have a thread with (and not ourselves).
  const suggestions = useMemo(() => {
    const known = new Set(threads.map((t) => t.peer));
    return inboxes.filter((i) => !known.has(i.pubkey) && i.pubkey !== pubkey);
  }, [inboxes, threads, pubkey]);

  // Keep the transcript pinned to the newest message.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedThread?.messages.length, selectedPeer]);

  function startNew() {
    const hex = toHexPubkey(newNpub);
    if (!hex) {
      setError("Enter a valid npub or 64-char hex pubkey");
      return;
    }
    setSelectedPeer(hex);
    setNewNpub("");
    setError(null);
  }

  async function onSend() {
    const peer = selectedPeer;
    if (!peer || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await send(peer, draft);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  }

  // ---- gate states --------------------------------------------------------
  if (status !== "authed") {
    return (
      <section className="dm-gate">
        <div className="dm-gate-card">
          <h2>Message an agent</h2>
          <p>Sign in with the login in the top-right to send a NIP-17 DM and watch an agent think.</p>
        </div>
      </section>
    );
  }
  if (!canDm) {
    return (
      <section className="dm-gate">
        <div className="dm-gate-card">
          <h2>This session can&apos;t send DMs</h2>
          <p>Your NIP-07 extension doesn&apos;t expose NIP-44 encryption. Log out and create or import a key to message agents.</p>
        </div>
      </section>
    );
  }

  // ---- chat ---------------------------------------------------------------
  return (
    <section className="dm">
      <aside className="dm-sidebar">
        <div className="dm-new">
          <label className="dm-new-label">New message</label>
          <div className="dm-new-row">
            <input
              className="dm-input mono"
              placeholder="agent npub1… or hex"
              value={newNpub}
              spellCheck={false}
              onChange={(e) => setNewNpub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") startNew();
              }}
            />
            <button className="dm-btn" onClick={startNew} disabled={!newNpub.trim()}>
              Start
            </button>
          </div>
        </div>

        {threads.length > 0 && (
          <div className="dm-list">
            <div className="dm-list-head">Conversations</div>
            {threads.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <button
                  key={t.peer}
                  className={`dm-thread-item${t.peer === selectedPeer ? " dm-thread-item--active" : ""}`}
                  onClick={() => setSelectedPeer(t.peer)}
                >
                  <span className="dm-thread-npub mono">{shortNpub(t.npub)}</span>
                  {last && <span className="dm-thread-preview">{last.fromOperator ? "you: " : ""}{last.text}</span>}
                </button>
              );
            })}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="dm-list">
            <div className="dm-list-head">Agents with an inbox</div>
            {suggestions.map((i) => (
              <button key={i.pubkey} className="dm-thread-item" onClick={() => setSelectedPeer(i.pubkey)}>
                <span className="dm-thread-npub mono">{shortNpub(i.npub)}</span>
                <span className="dm-thread-preview">accepts DMs</span>
              </button>
            ))}
          </div>
        )}

        {threads.length === 0 && suggestions.length === 0 && (
          <p className="dm-hint">No conversations yet. Paste an agent&apos;s DM npub above to start one. Agents that publish a NIP-17 inbox on this relay show up here automatically.</p>
        )}
      </aside>

      <div className="dm-main">
        {!selectedPeer ? (
          <div className="dm-empty">
            <p>Pick a conversation, or start one with an agent&apos;s DM npub.</p>
          </div>
        ) : (
          <>
            <div className="dm-thread-head">
              <span className="dm-peer mono" title={selectedThread?.npub ?? toNpub(selectedPeer)}>
                {shortNpub(selectedThread?.npub ?? toNpub(selectedPeer))}
              </span>
            </div>

            <div className="dm-transcript" ref={scrollRef}>
              {(selectedThread?.messages ?? []).length === 0 ? (
                <p className="dm-empty-thread">No messages yet — say hello. Every message is a gift-wrapped NIP-17 DM; the agent can only think and reply, never spend.</p>
              ) : (
                (selectedThread?.messages ?? []).map((m) => (
                  <div key={m.id} className={`dm-bubble${m.fromOperator ? " dm-bubble--me" : " dm-bubble--them"}`}>
                    <div className="dm-bubble-text">{m.text}</div>
                    <div className="dm-bubble-time mono">{clock(m.created_at)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="dm-composer">
              <textarea
                className="dm-composer-input"
                placeholder="Message the agent…  (Enter to send, Shift+Enter for a newline)"
                value={draft}
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />
              <button className="dm-send" onClick={() => void onSend()} disabled={!draft.trim() || sending}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
        {error && <div className="dm-error">{error}</div>}
      </div>
    </section>
  );
}
