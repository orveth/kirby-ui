# Signed-Event Feed Filtering — Design

**Date:** 2026-06-25
**Status:** design proposal — ready for implementation
**Scope:** Adds client-side filtering to the existing `signed event feed` panel (`Feed.tsx`). A user can narrow the feed by **event kind** and by **agent**, without weakening the panel's honesty framing (every row shown is signature-verified). No data-layer or relay-subscription changes — this is a pure render-layer filter over the already-verified `state.feed`.

> Non-goal: this does NOT change what the relay delivers or what the reducer stores. `clusterState.feed` keeps ingesting and capping all four FEED_KINDS exactly as today. Filtering is a *view* over that array.

---

## 1. The two filter dimensions

The feed array (`KirbyEvent[]`, newest-first, capped at `FEED_CAP=300`) contains only the four stored kinds — `FEED_KINDS = [LIFECYCLE (9100), LEDGER (9101), FAILOVER (9102), CUSTODY (9103)]`. Every row carries `kind`, `created_at`, `npub`, and `content.agent_id` (all four FEED content shapes have `agent_id`; the decoder rejects any without a string `agent_id`, so it is always present).

- **By kind** — the four FEED_KINDS, surfaced with their existing labels from `kindLabel()` (lifecycle / ledger / failover / custody). This is the primary, highest-value axis: it maps 1:1 to the panel's existing `sub` string "lifecycle · ledger · failover · custody".
- **By agent** — `content.agent_id` (failover-stable; never key by pubkey/npub — see the reducer's note). The set of agent_ids present is derivable either from `Object.keys(state.agents)` or from the feed itself.

### Combination semantics
The two dimensions combine with **AND**: a row is shown iff `kindActive[ev.kind] && (agentFilter == null || ev.content.agent_id === agentFilter)`. Within the kind dimension, the active kinds are a **set** (OR among themselves — "show lifecycle OR ledger"), then AND'd against the agent selection. This matches user intuition: "show me ledger + custody, for kirby-7."

### Default state
**All on.** Every kind active, no agent selected (= all agents). The feed at rest is identical to today's behavior — filtering is purely additive and opt-in, which protects the honesty framing (see §5) and means a returning/first-time user sees the full wall of attestations.

---

## 2. UI proposal

The `Panel` header already exposes a right-aligned `meta` slot (currently `"N signed"`). The constraint: filter controls should read as instrument chrome, not a form, and must visually live with the panel they filter. Three options:

### Option A — Row of toggleable kind chips in a panel sub-area (RECOMMENDED for MVP)
A thin control strip rendered as the **first child of the panel body** (between `panel-head` and the `<ol className="feed">`), holding four toggle chips: `lifecycle` `ledger` `failover` `custody`. Each chip is a `<button aria-pressed>` styled off the existing `.pill` / `.feed-kind--*` tone colors, so an active `ledger` chip wears the same accent the ledger rows wear — the filter legend *is* the row legend. Inactive chips dim (reduced opacity / muted border), active chips glow.

- **Pros:** Discoverable, zero hunting; reuses the strongest existing visual vocabulary (per-tone accent colors already defined: `--alive`, `--spend`, `--kirby-hot`, `--sky-blue`). Toggling is one click. Fits the "instrument cluster" aesthetic. Touch-friendly.
- **Cons:** Costs a horizontal strip of vertical space (~32px). Four chips + an agent control can get wide on the narrow side of the grid — but Feed is `wide` (full grid width), so there's room.

### Option B — Compact dropdown(s) in the `meta` slot
Replace/augment the `meta` chip with a small popover: a kinds checklist and an agent `<select>`.

- **Pros:** Near-zero resting footprint; keeps the header clean; scales if kinds grow.
- **Cons:** Hides state behind a click — you can't see at a glance that "custody is filtered out," which is exactly the honesty risk (§5). Popovers need focus-trap/escape/outside-click handling — more surface area than the MVP warrants. The repo has no existing popover primitive.

### Option C — Segmented control (single-select kind)
One-of-N segmented control: `all | lifecycle | ledger | failover | custody`.

- **Pros:** Smallest, cleanest; trivially honest ("all" is obviously the default).
- **Cons:** Single-select only — can't show "ledger + custody together." Loses the multi-select power that makes kind filtering useful. Rejected as the primary, but its `all` affordance informs the reset story below.

### Agent filtering
Offered **two complementary ways**, both feeding one piece of state (`agentFilter: string | null`):
1. **A compact `<select>`** in the control strip: `all agents ▾` + one option per agent_id (sorted, matching `AgentDashboard`'s `localeCompare` sort). Native select = accessible, zero new UI primitive, matches the lightweight-control convention (cf. `SoundToggle`'s native `<input type=range>` and `Header`'s `<input>` relay field).
2. **Click-an-agent-to-filter (nice-to-have, Phase 2):** clicking an `AgentCard` in `AgentDashboard` sets `agentFilter` to that agent_id and the Feed reflects it. This is a delightful cross-panel tie-in but requires lifting agent-filter state to `App` (§3) and adding affordance/active styling on the cards. Defer past MVP.

**Recommendation:** Option A (kind chips) + native agent `<select>`, both in a `.feed-filter` control strip at the top of the panel body. A small "clear / all" affordance resets to defaults. This keeps every active filter *visible* at all times (honesty), reuses existing color tokens and the `.pill`/chip styling language, and needs no new popover/focus machinery.

### Sketch (control strip)
```
[ ✨ lifecycle ] [ ★ ledger ] [ 💫 failover ] [ 🛡 custody ]      agent: [ all agents ▾ ]
   active          active        dimmed          active
```
Reuse the existing per-tone glyphs (`TONE_GLYPH`) on the chips for instant recognition. The agent `<select>` sits right-aligned within the strip.

---

## 3. State

### Where it lives
**MVP: local component state inside `Feed`** via `useState` — `activeKinds` (a `Set<number>` or a `Record<number, boolean>` seeded from `FEED_KINDS`) and `agentFilter: string | null`. The feed is self-contained; nothing else needs to read the filter, so lifting it to `App` is premature.

**Phase 2 (click-an-agent):** lift only `agentFilter` up to `App` so `AgentDashboard` can set it and `Feed` can read it. Kind filters stay local to `Feed`. This is a minimal, additive prop thread (`agentFilter` + `setAgentFilter`), consistent with how `App` already threads `relayUrl`/`setRelayUrl` into `Header`.

### Interaction with the live stream
Filtering must not break the real-time prepend. The mechanism is safe by construction: the reducer keeps prepending verified events to `state.feed`; `Feed` derives a `visible` array at render time:

```ts
const visible = feed.filter(ev =>
  activeKinds.has(ev.kind) &&
  (agentFilter == null || ev.content.agent_id === agentFilter)
);
```

Because filtering is a pure derivation over the live array (memoize with `useMemo` keyed on `[feed, activeKinds, agentFilter]`), new matching events still appear at the top instantly, and the `rowin` keyframe animation still fires (keyed by `ev.id`). A new event that doesn't match the active filter simply isn't rendered — it is still ingested, counted, and stored. No timers, no snapshotting, no scroll-jank introduced.

One nuance to call out for the implementer: the agent `<select>` option list should be derived from the **union of agent_ids seen in `feed`** (and/or `state.agents`) so that selecting an agent never strands the user on an empty option, and the list grows live as new agents emit events. If derived from `state.agents`, pass `agents` (already available in `App`) — but deriving from `feed` keeps `Feed` self-contained for the MVP.

### Counts and empty states
- **Header `meta`:** when any filter is active, show `"M / N signed"` (M visible of N total) so the user always sees that events exist beyond the current view — e.g. `"12 / 87 signed"`. When no filter is active, keep today's `"N signed"`. This count is the honesty anchor (§5).
- **Per-chip counts (nice-to-have):** a tiny tally on each kind chip (`custody · 0`) makes "no custody events *yet*" legible without filtering. Defer to Phase 2.
- **Filtered-empty state:** when `visible.length === 0` but `feed.length > 0`, render a distinct `.empty` message that does NOT imply nothing happened — e.g. *"no custody events yet — the cluster hasn't refused a rug on this view"* or, more generally, *"nothing matches this filter — N signed events are hidden, not gone."* This is different from today's true-empty copy (*"no signed events yet…"*), which still shows when `feed.length === 0`.

---

## 4. Honesty constraint (explicit)

The panel's entire identity is "a wall of attestations — every row cleared a Schnorr check." Filtering hides rows; it must never imply the hidden rows were unverified, fake, or rejected. Rules for the implementer:

1. **Filtering is visual subtraction over verified data, never a trust statement.** The verified `Seal` stays on every rendered row; the rejected-events alarm in the `Header` (`state.rejected`) is the *only* "we caught a fake" surface and is untouched by this feature. Keep these orthogonal — never reuse rejection styling/copy for "filtered out."
2. **Always surface that hidden ≠ absent.** The `"M / N signed"` meta count and the filtered-empty copy ("…hidden, not gone") make it explicit that the full verified set still exists. Never let an active filter render a bare empty panel that could read as "the cluster did nothing."
3. **Default-all-on + easy reset.** At rest the feed is the unfiltered wall. A visible "all/clear" affordance returns to it in one click, so the honest full view is never more than one action away.
4. **Filter chips describe *kinds*, not *validity*.** Copy stays neutral ("lifecycle", "ledger") — no "trusted/untrusted" framing.

---

## 5. Component / file breakdown

- **`src/components/Feed.tsx`** (primary change):
  - Add `useState` for `activeKinds` and `agentFilter` (MVP), or accept `agentFilter`/`setAgentFilter` props (Phase 2).
  - Add a `useMemo`'d `visible` derivation and an agent-option list derivation.
  - Render a new `FeedFilter` control strip as the first body child.
  - Update the `meta` prop to the `"M / N signed"` form when filtered.
  - Add the filtered-empty branch (distinct from the true-empty branch).
  - Keep `FeedRow` / `lineFor` / `rowTone` / `TONE_GLYPH` exactly as-is; map over `visible` instead of `feed`.
- **New `FeedFilter` sub-component** — colocate inside `Feed.tsx` (matches the file's existing convention of local helpers like `FeedRow`), unless it grows; only split to its own file if Phase 2 click-to-filter lands. Renders the four kind chips (off `FEED_KINDS` + `kindLabel` + `TONE_GLYPH`) and the agent `<select>`.
- **`src/index.css`** — add a `.feed-filter` strip rule (flex row, gap, baseline-aligned, small bottom margin), `.feed-chip` / `.feed-chip--active` / `.feed-chip--<tone>` chip rules (derived from existing `.pill` + `.feed-kind--*` tokens), and a `.feed-filter-agent` select rule (reuse the relay-field / select styling already present). No new color variables — reuse `--ink-*`, `--kirby-hot`, `--alive`, `--spend`, `--sky-blue`, `--line`, `--surf-0`.
- **`src/nostr/kinds.ts`** — no change required; already exports `FEED_KINDS` and `kindLabel`. (Optionally add a `feedKindTone(kind)` helper if the implementer wants to share the chip-tone mapping with `rowTone`, but not required.)
- **Phase 2 only:** `src/App.tsx` (lift `agentFilter`), `src/components/AgentDashboard.tsx` (clickable cards set the filter).

### Threading into existing Feed props
MVP keeps the `FeedProps` signature (`feed`, `now`) untouched — all filter state is internal. Phase 2 adds `agentFilter?: string | null` and `onAgentFilter?: (id: string | null) => void`, threaded from `App` exactly like the existing `relayUrl`/`setRelayUrl` pair into `Header`.

---

## 6. Scope / phasing (one focused PR)

**MVP (this PR):**
- Four toggleable kind chips (Option A), default all-on, multi-select with AND-against-agent.
- Agent `<select>` (native, derived option list, default "all agents").
- `useMemo`'d `visible` derivation; live-prepend preserved.
- `"M / N signed"` meta when filtered; filtered-empty honesty copy.
- CSS strip + chips reusing existing tokens.

**Nice-to-haves (later):**
- Click-an-`AgentCard`-to-filter cross-panel tie-in (requires lifting `agentFilter` to `App`).
- Per-chip live counts (`custody · 0`).
- Persistence of filter choice to `localStorage` (mirror the SoundToggle persistence pattern).
- A one-click "reset filters" pill when any filter is active.

This is sized for a single, reviewable PR touching primarily `Feed.tsx` + `index.css`.

---

### Critical files for implementation
- `src/components/Feed.tsx`
- `src/index.css`
- `src/nostr/kinds.ts`
- `src/components/Panel.tsx`
- `src/App.tsx` (Phase 2 only)
