// Presentational bits shared by the agent card (AgentDashboard) and the agent
// drill-down (AgentDetail), so copy and runway-bar logic live in one place.

import type { ReactNode } from "react";
import type { Lifecycle } from "../nostr/kinds";
import type { kirbyMood } from "./kirbyMood";

/** Lifecycle -> display copy. The data layer never emits invalid values; the
 *  default is just exhaustiveness insurance. */
export const LIFECYCLE_COPY: Record<Lifecycle | "unknown", string> = {
  born: "born",
  running: "running",
  dying: "dying…",
  dead: "dead · reaped",
  unknown: "pending",
};

/** Short mood caption under a mascot — pure copy, the face carries the meaning. */
export const MOOD_COPY: Record<ReturnType<typeof kirbyMood>, string> = {
  happy: "well fed",
  hungry: "hungry!",
  ko: "ko'd",
  spawn: "spawned!",
  sleepy: "resting",
  dizzy: "dizzy…",
};

/** A normalized runway bar. We can't know an absolute max runway, so the bar is a
 *  log-scaled fill that reads "lots / some / nearly broke" rather than a precise
 *  ratio — honest about being a vibe, not a claim. Empty + red when dead. */
export function RunwayBar({ treasury, runway, dead }: { treasury: number; runway: number | null; dead: boolean }) {
  const basis = runway ?? treasury;
  const pct = dead ? 0 : Math.max(2, Math.min(100, (Math.log10(Math.max(1, basis)) / 5) * 100));
  return (
    <div className="runway" aria-hidden="true">
      <div
        className={`runway-fill${dead ? " runway-fill--dead" : pct < 28 ? " runway-fill--low" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-k">{k}</span>
      <span className="field-v">{children}</span>
    </div>
  );
}

/** The dim-amber honesty chip shown wherever the publisher hasn't wired a value. */
export function Pending({ note, big }: { note?: string; big?: boolean }) {
  return (
    <span className={`pending${big ? " pending--big" : ""}`} title={note ?? "not yet wired by the cluster"}>
      pending{note && <span className="pending-note">{note}</span>}
    </span>
  );
}
