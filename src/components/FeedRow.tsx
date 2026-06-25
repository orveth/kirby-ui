// One signed-feed row, shared by the global feed and the per-agent drill-down so
// both narrate events with identical wording, tones, and the verified seal. Every
// row that reaches here cleared a Schnorr check upstream.

import type { ReactNode } from "react";
import type { KirbyEvent } from "../nostr/kinds";
import { KIND, kindLabel } from "../nostr/kinds";
import { shortNpub } from "../nostr/verify";
import { num, clock } from "./format";
import { Seal } from "./Seal";

/** Classify a row for accent styling. custody+failover are the "proof" tones. */
export function rowTone(ev: KirbyEvent): string {
  switch (ev.kind) {
    case KIND.NOTE:
      return "note";
    case KIND.CUSTODY:
      return ev.content.event === "single_node_spend_refused" ? "refused" : "quorum";
    case KIND.FAILOVER:
      return "failover";
    case KIND.LIFECYCLE:
      return ev.content.event === "died" ? "died" : "born";
    case KIND.LEDGER:
      return ev.content.kind === "earn" ? "earn" : "spend";
    default:
      return "default";
  }
}

/** A tiny Kirby-mood glyph per row tone — decorative, derived from the event. */
export const TONE_GLYPH: Record<string, string> = {
  note: "💬", // the agent speaks — its own public voice
  born: "✨", // a new puffball spawns
  died: "✕", // KO
  earn: "★", // fed
  spend: "🍴", // inhaled some sats
  failover: "💫", // warped to a new node, survived
  quorum: "🤝", // the quorum co-signs
  refused: "🛡️", // can't rug it
  default: "·",
};

export function FeedRow({ ev }: { ev: KirbyEvent }) {
  const tone = rowTone(ev);
  return (
    <li className={`feed-row feed-row--${tone}`}>
      <span className="feed-glyph" aria-hidden="true">{TONE_GLYPH[tone] ?? "·"}</span>
      <span className="feed-time mono">{clock(ev.created_at)}</span>
      <span className={`feed-kind feed-kind--${tone}`}>{kindLabel(ev.kind)}</span>
      <span className="feed-line">{lineFor(ev)}</span>
      <span className="feed-signer" title={`signed by ${ev.npub}`}>
        <Seal size={12} title="signature verified" />
        <span className="mono">{shortNpub(ev.npub)}</span>
      </span>
    </li>
  );
}

/** The human one-liner per kind. Amounts/ids in <b className="hl"> for emphasis. */
export function lineFor(ev: KirbyEvent): ReactNode {
  switch (ev.kind) {
    case KIND.NOTE: {
      // The agent's own words. Render the body verbatim as TEXT (React escapes it,
      // so the note can't inject markup); attribute to its agent_id when tagged,
      // else fall back to the signer npub shown in the row's signer column.
      const { agent_id, text } = ev.content;
      return (
        <>
          {agent_id ? <b className="hl">{agent_id}</b> : <b className="hl">agent</b>} posted{" "}
          <span className="feed-note">“{text}”</span>
        </>
      );
    }
    case KIND.LIFECYCLE: {
      const { agent_id, event, treasury_sats, reason } = ev.content;
      return event === "born" ? (
        <>
          <b className="hl">{agent_id}</b> was <b className="hl hl--born">born</b> ({reason},{" "}
          <span className="mono">{num(treasury_sats)} sats</span>)
        </>
      ) : (
        <>
          <b className="hl">{agent_id}</b> <b className="hl hl--died">died</b> — {reason}{" "}
          <span className="mono">({num(treasury_sats)} sats)</span>
        </>
      );
    }
    case KIND.LEDGER: {
      const { agent_id, kind, amount_sats, act, balance_after } = ev.content;
      const earn = kind === "earn";
      return (
        <>
          <b className="hl">{agent_id}</b> {earn ? "earned" : "spent"}{" "}
          <b className={`hl ${earn ? "hl--earn" : "hl--spend"} mono`}>
            {earn ? "+" : "−"}
            {num(amount_sats)}
          </b>{" "}
          <span className="muted">({act})</span> → balance{" "}
          <span className="mono">{num(balance_after)} sats</span>
        </>
      );
    }
    case KIND.FAILOVER: {
      const { agent_id, from_node, to_node, term, restored } = ev.content;
      return (
        <>
          <b className="hl">{agent_id}</b> failed over <span className="mono">{from_node}</span> →{" "}
          <b className="hl hl--failover mono">{to_node}</b>{" "}
          <span className="muted">(term {num(term)}, {restored.replace("_", " ")})</span> — survived
        </>
      );
    }
    case KIND.CUSTODY: {
      const { agent_id, event, detail } = ev.content;
      return event === "single_node_spend_refused" ? (
        <>
          <b className="hl hl--refused">rug refused</b> for <b className="hl">{agent_id}</b> —{" "}
          <span className="muted">{detail}</span>
        </>
      ) : (
        <>
          <b className="hl hl--quorum">quorum signed</b> for <b className="hl">{agent_id}</b> —{" "}
          <span className="muted">{detail}</span>
        </>
      );
    }
    default:
      return null;
  }
}
