// The signed event feed: the stored, append-only timeline (kinds 9100–9103),
// newest first. EVERY row cleared a Schnorr signature check before it reached this
// list, so each carries the "signed" seal — the feed is a wall of attestations.
// Row rendering lives in FeedRow (shared with the agent drill-down).

import type { KirbyEvent } from "../nostr/kinds";
import { num } from "./format";
import { Panel } from "./Panel";
import { FeedRow } from "./FeedRow";

interface FeedProps {
  feed: KirbyEvent[];
  now: number;
}

export function Feed({ feed }: FeedProps) {
  return (
    <Panel
      title="signed event feed"
      sub="note · lifecycle · ledger · failover · custody"
      meta={feed.length > 0 ? `${num(feed.length)} signed` : undefined}
      wide
    >
      {feed.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no signed events yet — the timeline writes itself as the cluster lives
        </div>
      ) : (
        <ol className="feed">
          {feed.map((ev) => (
            <FeedRow key={ev.id} ev={ev} />
          ))}
        </ol>
      )}
    </Panel>
  );
}
