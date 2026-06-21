// The mood mapping for the per-agent Kirby mascot. This is a PURE function of the
// real, signature-verified cluster state the AgentDashboard already holds — so the
// face stays honest: it can only ever reflect what the signed 31000/9100 events say.
// No mood invents a balance; "pending" agents read sleepy, never happy/hungry.

import type { AgentView } from "../nostr/clusterState";
import { displayLifecycle } from "../nostr/clusterState";

/** The expressions the Kirby SVG can wear, ranked from worst to best vitals. */
export type KirbyMood =
  | "ko" //     dead / reaped — X eyes, deflated, a star spinning above
  | "dizzy" //  dying — woozy/fading spiral eyes (the agent is on its way out)
  | "hungry" // running but starving soon (runway < threshold) — worried, open mouth
  | "happy" //  running and well-fed (treasury present, runway healthy) — content
  | "spawn" //  just born — sparkles, excited
  | "sleepy"; // no 31000 state yet / unknown — zzz, neutral (stays "pending" honest)

/** Below this many seconds of runway, a running Kirby reads as starving (hungry). */
export const HUNGRY_RUNWAY_SECS = 600;

/**
 * Derive a Kirby's expression from its real signed state. Mirrors the thresholds
 * the prompt/spec calls for, and leans only on `displayLifecycle` + the 31000
 * treasury/runway fields — the exact data the card already renders.
 */
export function kirbyMood(agent: AgentView): KirbyMood {
  const life = displayLifecycle(agent);
  if (life === "dead") return "ko";
  if (life === "dying") return "dizzy";
  if (life === "born") return "spawn";

  if (life === "running") {
    const treasury = agent.state?.treasury_sats ?? null;
    const runway = agent.state?.runway_secs ?? null;
    // Starving soon: a known, low runway. (runway null = unknown, not hungry.)
    if (runway != null && runway < HUNGRY_RUNWAY_SECS) return "hungry";
    // Well-fed: we actually know there's treasury and runway is healthy.
    if (treasury != null && runway != null && runway >= HUNGRY_RUNWAY_SECS) return "happy";
    if (treasury != null) return "happy"; // funded, runway not yet wired -> content
    return "sleepy"; // running but no economic state wired yet -> neutral, honest
  }

  // life === "unknown" (no 31000 yet) -> sleepy/neutral, keep the pending chips.
  return "sleepy";
}
