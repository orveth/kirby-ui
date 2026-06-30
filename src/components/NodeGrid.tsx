// The node-liveness grid: one cell per node (keyed by pubkey) fed by the 10100
// presence beacons. Liveness is computed at render time from `now - lastSeen`, so
// a node "dies" on the wall clock the instant its beacon goes quiet — this is the
// canvas for the kill demo: stop a node's daemon and watch its cell flip to DEAD.

import type { NodeView } from "../nostr/clusterState";
import { nodeLiveness } from "../nostr/clusterState";
import { shortNpub } from "../nostr/verify";
import { STALE_WINDOW_SECS } from "../config";
import { ago } from "./format";
import { Panel } from "./Panel";
import { Star } from "./Kirby";

interface NodeGridProps {
  /** The persistent fleet nodes to render, already filtered by `visibleNodes`
   *  (agent beacons + GONE nodes removed). NodeGrid only orders + renders. */
  nodes: NodeView[];
  now: number;
}

export function NodeGrid({ nodes, now }: NodeGridProps) {
  // Stable order: by node_id then pubkey, so cells don't jump around on re-render.
  const list = [...nodes].sort((a, b) =>
    (a.node_id ?? a.pubkey).localeCompare(b.node_id ?? b.pubkey),
  );
  const alive = list.filter((n) => nodeLiveness(n, now, STALE_WINDOW_SECS) === "alive").length;

  return (
    <Panel
      title="nodes"
      sub="presence beacons · kind 10100"
      meta={list.length > 0 ? `${alive}/${list.length} alive` : undefined}
    >
      {list.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          waiting for presence beacons…
        </div>
      ) : (
        <div className="node-grid">
          {list.map((node) => (
            <NodeCell key={node.pubkey} node={node} now={now} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function NodeCell({ node, now }: { node: NodeView; now: number }) {
  const live = nodeLiveness(node, now, STALE_WINDOW_SECS);
  const alive = live === "alive";

  return (
    <article className={`node-cell node-cell--${live}`} data-live={live}>
      <div className="node-cell-top">
        {/* the node as a Warp Star: bright + twinkling alive, dimmed + KO'd stale */}
        <span className={`warpstar warpstar--${live}`} aria-hidden="true">
          <svg viewBox="0 0 26 26" className="warpstar-svg">
            <Star cx={13} cy={13} r={12} />
          </svg>
        </span>
        <span className="node-id mono">{node.node_id ?? "unknown-node"}</span>
        <span className={`node-state node-state--${live}`}>{alive ? "ALIVE" : "DEAD · STALE"}</span>
      </div>

      <div className="node-cell-body">
        <Row k="npub" v={shortNpub(node.npub)} mono />
        <Row k="status" v={node.status || "—"} mono />
        <Row k="last beat" v={ago(node.lastSeen, now)} mono alarm={!alive} />
        {node.version && <Row k="version" v={node.version} mono />}
      </div>
    </article>
  );
}

/** A label/value line inside a cell; `alarm` reddens the value (dead node age). */
function Row({ k, v, mono, alarm }: { k: string; v: string; mono?: boolean; alarm?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={`kv-v${mono ? " mono" : ""}${alarm ? " kv-v--alarm" : ""}`}>{v}</span>
    </div>
  );
}
