// The bridge from signed cluster state -> sound. This hook watches the same
// ClusterState the faces render and fires a short SFX on REAL transitions, so the
// audio tracks the verified data exactly like the Kirby expressions do.
//
// Two hard rules baked in:
//
//  1. SKIP THE BACKLOG. On the first run we SEED a baseline — every feed event id
//     already present, the current `rejected` count, and each agent's current mood
//     — WITHOUT playing anything. On load a relay back-fills hundreds of stored
//     feed events; replaying those would be cacophony. We only ever sound the
//     deltas that arrive AFTER the baseline is captured.
//
//  2. NEVER while muted. The engine itself no-ops when muted, but we also avoid
//     doing the diffing work / marking things "announced" so that unmuting later
//     doesn't suddenly fire a stale burst. We re-seed whenever audio is (re)enabled.
//
// A gentle throttle staggers simultaneous events (e.g. three borns landing in one
// render) so a burst doesn't blast as a single wall of sound. Meter ticks (kind
// 21000, ~1-2s cadence) are deliberately NOT sounded — far too frequent.

import { useEffect, useRef } from "react";
import type { ClusterState } from "../nostr/clusterState";
import { KIND } from "../nostr/kinds";
import { kirbyMood, type KirbyMood } from "../components/kirbyMood";
import { sound, type Sfx } from "./engine";

/** Spacing between queued SFX in a single batch, so a burst lilts instead of blares. */
const STAGGER_SECS = 0.13;
/** Most SFX we'll let fire from one render pass (hard cap against a flood). */
const MAX_PER_FLUSH = 6;

export function useClusterSound(state: ClusterState): void {
  // ids of feed events we've already accounted for (seeded or sounded).
  const seenFeed = useRef<Set<string>>(new Set());
  // last rejected count we observed (to detect increments = a forged drop).
  const lastRejected = useRef<number>(0);
  // per-agent last mood, to fire lowRunway exactly once per healthy->hungry edge.
  const lastMood = useRef<Map<string, KirbyMood>>(new Map());
  // whether we've captured the initial baseline yet (under the current audio-on).
  const seeded = useRef<boolean>(false);
  // whether audio was audible on the previous run (to re-seed on each enable).
  const wasAudible = useRef<boolean>(false);

  useEffect(() => {
    const audible = sound.isAudible();

    // --- (re)seed the baseline whenever audio becomes available ---------------
    // First mount is muted-by-default, so this seeds silently. When the user later
    // unmutes, `audible` flips true and we re-seed against the THEN-current state
    // so the act of unmuting never replays the existing feed/moods.
    if (!seeded.current || (audible && !wasAudible.current)) {
      seenFeed.current = new Set(state.feed.map((e) => e.id));
      lastRejected.current = state.rejected;
      const moods = new Map<string, KirbyMood>();
      for (const agent of Object.values(state.agents)) {
        moods.set(agent.agent_id, kirbyMood(agent));
      }
      lastMood.current = moods;
      seeded.current = true;
      wasAudible.current = audible;
      return; // nothing to play on the seeding pass
    }
    wasAudible.current = audible;

    // If we can't be heard, just keep our refs current (treat everything as seen)
    // so that a later unmute won't fire a backlog. The re-seed branch above will
    // also run on the enable edge as a belt-and-braces baseline.
    if (!audible) {
      for (const e of state.feed) seenFeed.current.add(e.id);
      lastRejected.current = state.rejected;
      for (const agent of Object.values(state.agents)) {
        lastMood.current.set(agent.agent_id, kirbyMood(agent));
      }
      return;
    }

    // --- collect this pass's NEW sounds, then flush them staggered ------------
    const queue: Sfx[] = [];

    // (a) forged-event rejections: the rejected counter ticked up.
    if (state.rejected > lastRejected.current) {
      queue.push("rejected");
      lastRejected.current = state.rejected;
    }

    // (b) new feed events (newest-first; walk oldest-first so sounds play in the
    //     order they happened). Only ids we haven't seen before.
    const fresh = [];
    for (const ev of state.feed) {
      if (seenFeed.current.has(ev.id)) continue;
      seenFeed.current.add(ev.id);
      fresh.push(ev);
    }
    fresh.reverse(); // oldest first
    for (const ev of fresh) {
      const sfx = sfxForFeedEvent(ev);
      if (sfx) queue.push(sfx);
    }

    // (c) per-agent mood edges -> hungry (low runway), once per transition. The
    //     `died` feed event owns the KO sound, so we never fire on ->ko here.
    for (const agent of Object.values(state.agents)) {
      const mood = kirbyMood(agent);
      const prev = lastMood.current.get(agent.agent_id);
      lastMood.current.set(agent.agent_id, mood);
      if (prev !== undefined && prev !== "hungry" && mood === "hungry") {
        queue.push("lowRunway");
      }
    }

    if (queue.length === 0) return;

    // Flush with a tiny stagger so simultaneous events don't stack into a blast.
    // De-dupe identical SFX within a single flush (3 borns at once -> one chime
    // is plenty) and cap the total.
    const unique: Sfx[] = [];
    const seenInFlush = new Set<Sfx>();
    for (const s of queue) {
      if (seenInFlush.has(s)) continue;
      seenInFlush.add(s);
      unique.push(s);
      if (unique.length >= MAX_PER_FLUSH) break;
    }

    unique.forEach((s, i) => {
      if (i === 0) sound.play(s);
      else window.setTimeout(() => sound.play(s), Math.round(i * STAGGER_SECS * 1000));
    });
  }, [state]);
}

/** Map a feed event to its SFX (or null for "no sound" / soft cases). */
function sfxForFeedEvent(ev: ClusterState["feed"][number]): Sfx | null {
  switch (ev.kind) {
    case KIND.LIFECYCLE:
      return ev.content.event === "born" ? "born" : "died"; // born / died KO
    case KIND.LEDGER:
      // earn = coin blip; spend stays silent (a debit isn't a celebration, and
      // spends are frequent — keeping them quiet avoids constant ticking).
      return ev.content.kind === "earn" ? "earn" : null;
    case KIND.FAILOVER:
      return "failover"; // the warp-star whoosh: a node fell, the cluster survived
    case KIND.CUSTODY:
      return ev.content.event === "quorum_signed" ? "quorum" : "spendRefused";
    default:
      return null;
  }
}
