# Agent Drill-Down — Design Spec

**Date:** 2026-06-25
**Repo:** kirby-ui (React 18 + TypeScript + Vite, pure Nostr client)
**Status:** proposed

## 1. The data question (feasibility first)

This determines everything, so it comes first. Findings from reading `src/nostr/clusterState.ts` and `src/nostr/kinds.ts`:

**What the app already holds, keyed by `agent_id`:**
- `state.agents[agent_id]: AgentView` — current 31000 state (`treasury_sats`, `runway_secs`, `lifecycle`, `lease_holder_node`, `lease_term`, `backend`), plus `node_id`, `firstSeen`, `lastUpdate`, `stateAt`, `lastLifecycleEvent`. This is the full current state for the detail header.
- `state.meters[agent_id]: MeterView` — latest 21000 tick (cpu/mem/egress/fidelity, ephemeral, live-only).

**What it does NOT hold — the gap:**
- `state.feed` is a **single global, newest-first list capped at `FEED_CAP = 300`**. It is **not indexed by `agent_id`**. There is no per-agent event history structure today.
- Per-agent history is therefore *derivable but not stored*: every feed item (9100/9101/9102/9103) carries `content.agent_id`, so the timeline for one agent is `state.feed.filter(e => "agent_id" in e.content && e.content.agent_id === id)`.

**Consequences / honesty constraints:**
- The timeline is **bounded by the global 300-event cap**. A drill-down shows "this agent's events *currently in the feed window*", not its complete lifetime history. Honest and acceptable for MVP, but the copy must say "recent" not "complete".
- 21000 meter ticks are ephemeral and not in the feed, so there is **no historical treasury series** stored. Treasury values *do* appear inside 9101 ledger events (`balance_after`) and 9100 lifecycle events (`treasury_sats`). So a treasury sparkline is renderable **only from ledger/lifecycle events the feed happens to hold** — sparse and capped, not a continuous series. Treat as nice-to-have, clearly labelled, never interpolated.
- `AgentView` has **no `npub`/`pubkey` field**. Identity ("signed by") lives on individual events (`KirbyEvent.npub`). For the header we surface the signer(s) of *that agent's events* (the lease-holding node's npub from its most recent event); we cannot show a single canonical agent npub because an agent is failover-stable across changing signing nodes.
- **There is no "Q identity" field anywhere in the data** (`kinds.ts` defines none). Do not invent one. The header identity section is: `agent_id` (the stable key), current `lease holder` node_id, `backend`, and signer npub(s) drawn from real events.

**Recommended data-layer change (small, optional for MVP):** add a pure selector, not new stored state:

```ts
// clusterState.ts — render-time selector, no new state, no reducer change
export function agentTimeline(state: ClusterState, agentId: string): KirbyEvent[] {
  return state.feed.filter(
    (e) => "agent_id" in e.content && e.content.agent_id === agentId,
  ); // already newest-first; feed is maintained newest-first
}
```

Keeps the reducer untouched (no new index, no cap-eviction bookkeeping) and stays within the "compute views at render time" ethos already used for liveness. A dedicated per-agent index is **not justified for MVP** — the feed is only 300 items and filtering is trivially cheap.

**Verdict: feasible now, no reducer change required.** MVP renders current state (rich, complete) + a recent signed timeline (capped, honestly labelled). Sparkline is aspirational/phase-2.

## 2. Interaction model

**Option A — Modal overlay (reuse `.auth-overlay` / `.auth-modal`).** The app already ships this pattern in `ConfirmSign.tsx`: fixed full-screen `.auth-overlay` (z-index 50, backdrop blur, click-backdrop-to-close), centered `.auth-modal` + `.auth-modal-head` + `.auth-close`.
- Pros: zero new layout primitives; matches existing modal styling/behaviour; trivial open/close state; works on narrow viewports; accessible dialog scaffolding already proven in repo.
- Cons: `.auth-modal` is `min(440px, 100%)` — too narrow for a timeline; needs a wider variant. Overlay covers the dashboard.

**Option B — Right-side drawer/panel.** Dashboard stays visible/dimmed behind.
- Pros: keeps cluster context visible.
- Cons: new layout + animation primitives not in the codebase; responsive work; more CSS than MVP warrants.

**Option C — URL route (`?agent=<id>`).**
- Pros: deep-linkable/shareable, back-button closes.
- Cons: no router in `package.json`; adding `react-router` is disproportionate. A hand-rolled `?agent=` query param (mirroring `?relay=`) is possible but adds history/popstate handling for marginal MVP benefit.

**Recommendation: Option A (modal overlay) with a new `--wide` modal variant.** Reuses a proven, themed, accessible pattern; least new surface area; fits one PR. Add `?agent=` deep-linking as phase-2 — cheap to bolt onto the same `selectedAgentId` state.

## 3. What the detail view shows

**Header / current state (all renderable now from `AgentView` + selectors):**
- The Kirby mascot at a larger size (`<Kirby mood={kirbyMood(agent)} active size={160} />`) — reuse `kirbyMood`, `Kirby`. The face is already a pure function of signed state.
- `agent_id` (mono), lifecycle pill (reuse `LIFECYCLE_COPY` + `pill--{life}`), mood caption (`MOOD_COPY`).
- Treasury (big), runway, backend badge, lease holder / lease term, sovereign handling — **reuse the exact field logic from `AgentCard`** (treasury `Pending` chip when null, `RunwayBar`, sovereign branch). Don't duplicate; extract shared bits (§4).
- Identity block: `agent_id` (stable key), current `lease holder` node_id, `backend`, `firstSeen` ("born seen at") + `lastUpdate` ("last update Ns ago"). Signer npub via `shortNpub` from the newest event for this agent, with a `<Seal>`. **No Q identity.**
- Live meter, if `state.meters[id]` exists and `meterIsLive`: reuse the `Meters` `Gauge`/readouts. If idle/absent, show "no signal".

**Timeline (renderable now, capped):**
- Chronological list of this agent's signed events from `agentTimeline(state, id)`, rendered with the **existing `Feed` row visual language** (glyph + time + kind + human line + signer seal). The `lineFor` copy in `Feed.tsx` already produces per-kind human sentences for 9100–9103 — extract and reuse it (§4).
- Order: present **oldest-first (chronological born→died)** for a "story" reading — reverse the filtered slice. Label honestly: "recent signed events (within the live feed window)".

**Sparkline (aspirational, phase-2):** a treasury trace from `balance_after` (9101) + `treasury_sats` (9100) points in the timeline. Sparse, capped, event-driven — render as discrete points/steps, never smooth interpolation. Omit from MVP.

## 4. Component breakdown & state management

**New files:**
- `src/components/AgentDetail.tsx` — the modal. Props: `{ agent: AgentView; meter: MeterView | undefined; timeline: KirbyEvent[]; now: number; onClose: () => void }`. Renders inside `.auth-overlay` > wide `.auth-modal`, backdrop-click and Escape to close.
- Extract shared presentational bits currently private in `AgentDashboard.tsx`: `Field`, `Pending`, `RunwayBar`, and the `LIFECYCLE_COPY` / `MOOD_COPY` maps — so card and detail share one source of copy/thresholds.
- Extract `lineFor` + `rowTone` + `TONE_GLYPH` from `Feed.tsx` into a `FeedRow` component so both `Feed` and `AgentDetail` render identical rows. Refactor, not new behaviour.

**Data selector:** `agentTimeline(state, agentId)` in `clusterState.ts`. Pure, render-time, no reducer change.

**State management — minimal:** a single piece of UI state, the selected agent id. **Recommended: `selectedId` lives in `App`** (the composition root already holds `state` + `now`), avoiding threading `feed`/`meters` into `AgentDashboard` purely for drill-down. `AgentDashboard` gains an `onSelect?: (id: string) => void` prop. `App` renders:

```tsx
selectedId && state.agents[selectedId] && (
  <AgentDetail
    agent={state.agents[selectedId]}
    meter={state.meters[selectedId]}
    timeline={agentTimeline(state, selectedId)}
    now={now}
    onClose={() => setSelectedId(null)}
  />
)
```

Make `AgentCard` keyboard-accessible (`role="button"`, `tabIndex={0}`, Enter/Space) calling `onSelect(agent.agent_id)`; add `cursor: pointer` + a focus ring.

## 5. Edge / empty / loading states

- **No 31000 yet** (`agent.state === null`, lifecycle "unknown"): mascot `sleepy`, economic fields show `Pending`. Header: "pending — no signed state yet". Don't fabricate.
- **Dead/reaped** (`life === "dead"`): mascot `ko`, dead styling, runway empty/red. Timeline shows the terminal `died` row.
- **No history** (timeline empty): Feed's `.empty` treatment — "no signed events for this agent in the live feed window yet". Honest about the cap.
- **No live meter:** "no signal", mirroring `Meters`. Never render a stale gauge as live.
- **Selected agent disappears / relay reset:** `App` guards with `state.agents[selectedId]`; auto-clear `selectedId` in an effect when the key is gone to avoid a blank modal.
- **Accessibility:** `role="dialog" aria-modal="true"`, Escape closes, focus the close button on open, restore focus to the originating card on close.

## 6. Scope / phasing (one focused PR)

**MVP (this PR):**
1. `agentTimeline` selector in `clusterState.ts`.
2. Refactor: extract `FeedRow` (+ `lineFor`/`rowTone`/`TONE_GLYPH`) from `Feed.tsx`; extract `Field`/`Pending`/`RunwayBar`/copy maps from `AgentDashboard.tsx`. No behaviour change.
3. `AgentDetail.tsx` modal reusing `.auth-overlay` + a new wide variant. Header (mascot + current state) + identity block + live meter (reuse gauge if live else no-signal) + chronological timeline (reused FeedRow, oldest-first, labelled, empty state).
4. Clickable/keyboard-accessible `AgentCard`; `selectedId` in `App`; open/close + Escape + backdrop + focus management.
5. CSS: wide modal variant, card cursor/focus ring, detail layout — existing CSS variables, respecting `prefers-reduced-motion`.

**Nice-to-haves (later):**
- `?agent=<id>` deep link / back-button close.
- Treasury sparkline from 9101/9100 points (discrete, labelled, no interpolation).
- Drawer interaction model if context-alongside becomes desirable.
- A reducer-side per-agent index only if the global feed cap is raised materially.

## Critical files for implementation
- `src/nostr/clusterState.ts`
- `src/components/AgentDashboard.tsx`
- `src/components/Feed.tsx`
- `src/App.tsx`
- `src/index.css`
