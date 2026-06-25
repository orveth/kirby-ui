// The signed event feed: the stored, append-only timeline (kinds 9100–9103),
// newest first. EVERY row cleared a Schnorr signature check before it reached this
// list, so each carries the "signed" seal — the feed is a wall of attestations.
//
// Filtering (by kind + by agent) is a pure render-layer view over the verified
// feed: it hides rows from view, it never implies the hidden rows were unverified.
// The "M / N signed" meta and the filtered-empty copy keep "hidden ≠ absent" clear.

import { useMemo, useState } from "react";
import type { KirbyEvent } from "../nostr/kinds";
import { FEED_KINDS, KIND, kindLabel } from "../nostr/kinds";
import { num } from "./format";
import { Panel } from "./Panel";
import { FeedRow, TONE_GLYPH } from "./FeedRow";
import { filterFeed, toggleKind as toggleKindIn, agentIdOf } from "./feedFilter";

interface FeedProps {
  feed: KirbyEvent[];
  now: number;
}

/** Representative chip styling per feed kind (reuses the row tone color tokens). */
const KIND_CHIP: Record<number, { tone: string; glyph: string }> = {
  [KIND.NOTE]: { tone: "note", glyph: TONE_GLYPH.note },
  9100: { tone: "born", glyph: TONE_GLYPH.born },
  9101: { tone: "earn", glyph: TONE_GLYPH.earn },
  9102: { tone: "failover", glyph: TONE_GLYPH.failover },
  9103: { tone: "refused", glyph: TONE_GLYPH.refused },
};

export function Feed({ feed }: FeedProps) {
  const [activeKinds, setActiveKinds] = useState<Set<number>>(() => new Set(FEED_KINDS));
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  const filtering = activeKinds.size < FEED_KINDS.length || agentFilter != null;

  const visible = useMemo(
    () => filterFeed(feed, activeKinds, agentFilter),
    [feed, activeKinds, agentFilter],
  );

  // Agents seen in the feed, for the agent <select> (sorted, live-growing).
  const agentOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const ev of feed) {
      const id = agentIdOf(ev);
      if (id) ids.add(id);
    }
    return [...ids].sort((a, b) => a.localeCompare(b));
  }, [feed]);

  const toggleKind = (kind: number) => setActiveKinds((prev) => toggleKindIn(prev, kind));

  const reset = () => {
    setActiveKinds(new Set(FEED_KINDS));
    setAgentFilter(null);
  };

  const meta =
    feed.length === 0
      ? undefined
      : filtering
        ? `${num(visible.length)} / ${num(feed.length)} signed`
        : `${num(feed.length)} signed`;

  return (
    <Panel title="signed event feed" sub="note · lifecycle · ledger · failover · custody" meta={meta} wide>
      {feed.length > 0 && (
        <div className="feed-filter">
          <div className="feed-filter-kinds" role="group" aria-label="filter by event kind">
            {FEED_KINDS.map((kind) => {
              const chip = KIND_CHIP[kind];
              const active = activeKinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  className={`feed-chip feed-chip--${chip?.tone ?? "default"}${active ? " feed-chip--active" : ""}`}
                  onClick={() => toggleKind(kind)}
                >
                  <span aria-hidden="true">{chip?.glyph ?? "·"}</span>
                  {kindLabel(kind)}
                </button>
              );
            })}
          </div>

          <div className="feed-filter-agent">
            <label htmlFor="feed-agent" className="muted">
              agent
            </label>
            <select
              id="feed-agent"
              className="mono"
              value={agentFilter ?? ""}
              onChange={(e) => setAgentFilter(e.target.value || null)}
            >
              <option value="">all agents</option>
              {agentOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {filtering && (
              <button type="button" className="feed-filter-reset" onClick={reset}>
                clear
              </button>
            )}
          </div>
        </div>
      )}

      {feed.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no signed events yet — the timeline writes itself as the cluster lives
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          nothing matches this filter — {num(feed.length)} signed events are hidden, not gone
        </div>
      ) : (
        <ol className="feed">
          {visible.map((ev) => (
            <FeedRow key={ev.id} ev={ev} />
          ))}
        </ol>
      )}
    </Panel>
  );
}
