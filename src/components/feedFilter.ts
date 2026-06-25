// Pure feed-filter logic, kept out of the component so it is directly testable.
// Filtering is visual subtraction over already-verified rows — see Feed.tsx.

import { FEED_KINDS, type KirbyEvent } from "../nostr/kinds";

/** Read an event's agent_id (every feed kind carries one). */
export function agentIdOf(ev: KirbyEvent): string | null {
  return "agent_id" in ev.content ? ev.content.agent_id : null;
}

/** Keep events whose kind is active AND (no agent filter, or agent matches). */
export function filterFeed(
  feed: KirbyEvent[],
  activeKinds: Set<number>,
  agentFilter: string | null,
): KirbyEvent[] {
  return feed.filter(
    (ev) => activeKinds.has(ev.kind) && (agentFilter == null || agentIdOf(ev) === agentFilter),
  );
}

/** Toggle a kind in the active set. Toggling off the LAST active kind resets to
 *  all kinds — an empty feed would read as "the cluster did nothing", which is
 *  dishonest; the resting state is always the full wall. */
export function toggleKind(activeKinds: Set<number>, kind: number): Set<number> {
  const next = new Set(activeKinds);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return next.size === 0 ? new Set(FEED_KINDS) : next;
}
