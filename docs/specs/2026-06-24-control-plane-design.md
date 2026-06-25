# Kirby Control Plane — Design (login → create → see yours → top up)

**Date:** 2026-06-24 · **Updated:** 2026-06-25 (turtle/node review folded in)
**Status:** reviewed by keeper:kirby (turtle) — design blessed; a few numbers left
for gudnuf (§9). UI P0 (login) cleared to build now.
**Scope:** Adds a human-operator *write* path to the Kirby fleet. Today the UI
(`kirby-ui`) is a read-only Nostr client and the node (`kirby-node`) only
*publishes* state. This adds: a logged-in human can **create** an autonomous
agent and **fund/top-up** an existing one — using **real ecash** — and see the
agents they created.

> Non-goal: there is no `kill`/`stop`. Agents are fully autonomous after birth;
> they live until they run out of money (die-when-broke). The only levers a human
> has are *bring one into existence* and *give it more runway*.

---

## 1. The flow

```
operator (human, logged in via Nostr key)
   │  1. signs a CREATE command carrying an ecash token (the seed funding)
   ▼
relay  ── public, the API for both reads and writes ──
   ▼
any available Fleet-host node  ── claims the job via the lease seam (#35) ──
   │  2. redeems the ecash → seeds the new agent's treasury
   │  3. spawns the tenant (kirby run), stamping it with the operator's npub
   ▼
new agent → emits 9100 born + 31000 state (today), now creator-tagged
   │
UI  ── filters "agents I created" by operator-npub tag, renders them,
        offers TOP-UP (a FUND command carrying more ecash)
```

Four capabilities, in priority order: **login**, **create** (top priority),
**see-your-agents**, **top-up**.

### Three keys (don't conflate them)

1. **Operator key** — the human's login key. Signs `OP_CREATE`/`OP_FUND`. Its npub
   becomes the **creator** tag on the agent's events.
2. **Agent key `Q`** — the agent's *own* sovereign identity, a **2-of-3 FROST
   threshold key provisioned at spawn** (the fleet supervisor's launch path runs a
   trusted-dealer keyset ceremony; the agent signs its own 9100/31000/notes through
   its quorum). The agent's npub *is* `Q`.
3. **Node/holder keys** — internal to the fleet, not user-facing.

So "stamp the agent with the operator npub" means **add a creator reference**, not
set the agent's identity. `OP_CREATE` → node provisions `Q` → agent is born *as* `Q`,
tagged `["p", <operator>]`. "Agents I created" filters by the creator tag, which is
**orthogonal to `Q`** (and orthogonal to the existing signer-pubkey→agent_id mapping
the feed already does from presence/state).

---

## 2. Identity & login (UI-only, no node changes)

Build bespoke on `nostr-tools` (the `nostr-login` library is rejected: it can't
import an existing nsec — open upstream issue — and it's tuned for social apps).

Login methods, in the order the modal presents them:

1. **NIP-07 browser extension** (`window.nostr`) — preferred; keys never enter the
   app. Detect at login time (not page load); if absent, link to Alby/nos2x.
2. **Create a key locally** (new-to-Nostr path) — `generateSecretKey()`; store as a
   **NIP-49 `ncryptsec`** in localStorage (passphrase-encrypted, scrypt LOG_N=16);
   decrypt to an in-memory `Uint8Array` per session; never persist raw nsec.
   Includes a "back up your key" step before publishing is enabled.
3. **Import existing key** (advanced, de-emphasized) — `nsec1…`/`ncryptsec1…` paste
   → NIP-49 encrypt at rest → in-memory only. One-line risk warning.

> NIP-46 "bunker" remote signing is explicitly **out of scope** (gudnuf, 2026-06-24).

**Confirm-before-sign.** Because a signed event here is a *command that spends real
sats / spawns compute*, every `signEvent` is gated by a confirmation UI that shows
exactly what is being authorized (action, amount, mission). This is a security
requirement, not a nicety.

Post-login state: keep `pubkey`/`npub` in React context; for the local-key path keep
the secret key in a ref and zero it on logout; for NIP-07 no key material lives in
app state at all.

---

## 3. Authorization / anti-spam: Proof of Power (PoP = the `pops` project)

The gate on a `create` command is **Proof of Power** — the `pops` system
(`/srv/forge/projects/pops`): *ecash access-control credentials backed by
CLTV-locked Bitcoin.* It is **not an allowlist, not NIP-13 PoW, and not a payment.**

- A **PoP credential** is a Cashu bearer token (`cashuB`) under a `pop_<ts_expiry>`
  unit, whose backing is a **time-locked BTC UTXO** (P2TR, NUMS internal key, a single
  CLTV recovery leaf). It proves the bearer **locked recoverable capital** — costly,
  hence sybil/spam-resistant — but **no money changes hands**: the credential *expires
  before* the funder can reclaim the BTC. Anti-spam via "power" (locked capital).
- The **seed token** (§4.1) is ordinary money ecash, *spent* and credited to the new
  agent's treasury. Two genuinely different ecash flows — keep both fields.

**Node verifies** by demanding an exact `pop` amount and **swapping (consuming) the
presented credential** against the mint; a successful swap proves valid locked capital.
The required power amount is **node policy** ("spawning costs a pop of ≥ X locked sats"
— number TBD by gudnuf, §9).

**PoP gates `OP_CREATE` only**, not `OP_FUND` — spawning compute is the costly/spammy
op; topping up an existing agent is self-limiting (you're handing it money). Don't
double-gate.

**UI implication:** like the seed token, **the human pastes a `pop` token** minted
out-of-band via the pops CLI/skill. A brand-new local-key user *cannot* produce a PoP
without locking real BTC (that's the point). An in-browser pop-minting UX (on-chain
lock from the browser) is a real later project, not v0.

---

## 4. New event kinds (coordinate with keeper:kirby-nostr contract)

The existing locked contract (`kirby-cluster-event-kinds-20260619.md`) is all
node→world *state*. This adds the first world→node *commands* and their acks. Kinds
below are **proposals**; final numbers are keeper:kirby-nostr's call.

| Kind  | Range        | Name            | Direction        | Purpose |
|-------|--------------|-----------------|------------------|---------|
| 24000 | ephemeral    | `OP_CREATE`     | operator → fleet | "spawn an agent, here's the seed ecash + mission + pop" |
| 24001 | ephemeral    | `OP_FUND`       | operator → fleet | "credit this agent, here's more ecash" |
| 24100 | ephemeral    | `OP_ACK`        | node → operator  | claim/result for a given command (`accepted`/`rejected`/`spawned`/`credited`) |

Notes:
- **Ephemeral** (2xxxx): commands shouldn't linger in relay storage; the resulting
  *state* (9100 born, 31000) is the durable record.
- **Reconcile with the existing "spawn-request" concept** ⚠️ — the fleet spec already
  floated *"spawn = a signed spawn-request Nostr event (a create-fresh cousin of the
  31001 wake event)."* `OP_CREATE` must be reconciled with that so we don't mint two
  spawn concepts. (keeper:kirby-nostr + gudnuf to settle — §9.)
- **Creator linkage:** spawned-agent events (9100/31000) gain a `["p", <operator_pubkey>]`
  **tag** (turtle: prefer a tag over a content field — filterable in the relay REQ).
  Small, backward-compatible, and orthogonal to the agent's own signer `Q`.
- All command events carry `["t","kirby"]` and are signed by the operator key (so the
  fleet knows who asked, and the ack can be addressed back with `["p", operator]`).

### 4.1 `OP_CREATE` content (proposal)
```json
{
  "mission": "free-text task descriptor (optional) — UNTRUSTED, node sanitizes",
  "seed_token": "cashuA… (a money Cashu token, the seed funding — REQUIRED, human-pasted)",
  "pop": "cashuB… (a Proof-of-Power credential, pop_<expiry> unit — REQUIRED, human-pasted)",
  "nonce": "client-random, for ack correlation + replay dedup"
}
```
No backend, no brokered-act allowlist, no budget knob — the scheduler picks the node,
agents get the full capability set, and the seed amount is read from the token. The
`mission` is operator free text reaching the genome, so the node treats it as untrusted:
strip control chars + cap length/charset (reuse the note-sanitize pattern) before boot.

### 4.2 `OP_FUND` content (proposal)
```json
{
  "agent_id": "the target agent",
  "topup_token": "cashuA… (more ecash — REQUIRED)",
  "nonce": "client-random, for replay dedup"
}
```

### 4.3 `OP_ACK` content (proposal)
```json
{
  "nonce": "echoes the command nonce",
  "status": "accepted | rejected | spawned | credited",
  "agent_id": "present once known",
  "node_id": "which node claimed it",
  "reason": "human string on reject (bad token, double-spend, no capacity)"
}
```

---

## 5. The ecash funding rail (node-side — turtle)

Real money, **ecash only** (Cashu), no on-chain in v0. The node has the *outbound* half:
`CdkEcashRail` melts proofs against a local cdk-fakewallet mint to pay for brokered acts.
The *inbound* half is **net-new** (turtle confirmed: `treasury.rs` has only
`debit_metered`/`debit_and_record` — **no credit path exists today**). Crucially, this
inbound redeem→credit is the **same primitive the earn loop (#6) needs** — build once,
reuse for both create-funding and agents earning.

1. **Redeem-on-create / redeem-on-fund:** the node receives a money Cashu token in the
   command, **redeems it into a host-held wallet against the same mint**, and credits
   the amount to the (new or existing) agent treasury via a new `treasury.credit(amount)`
   (`mint_rig.rs` already builds + funds CDK wallets to build on).
2. **Validation:** a token that is missing, malformed, below the minimum seed,
   already-spent, or from an unknown mint → `OP_ACK status=rejected`. No spawn, no
   credit. Separately, an invalid/absent **Proof of Power** → reject before any
   redeem (authorization precedes funding).
3. **Replay safety:** dedup by `(operator_pubkey, nonce)` AND rely on the mint
   (a redeemed token can't be redeemed twice). Both, belt-and-suspenders.
4. **Mint trust:** v0 uses the local fakewallet mint (play settlement, real protocol).
   The token's mint URL must be on the node's accepted-mint list.

---

## 6. "Run on any available node" — claim/lease (node-side — turtle)

The node is **"deaf" today** — the genome is pure-pull, there is **no inbound command
subscriber**. Building one is net-new, and it's the **same "wake-on-event" primitive**
the earn loop (#6) and inbound DMs (#12) need — build once, reuse three ways.

Multiple Fleet-host nodes subscribe to `OP_CREATE`. Exactly one must spawn the agent.
The **#35 `LeaseAuthority` seam** is the right primitive (today it fences an *existing*
agent's run; spawn-claim is a new use: claim a job keyed by `(operator_pubkey, nonce)`).

**Full server flow per `OP_CREATE`:**
```
claim lease (operator,nonce)  →  verify PoP (swap the cashuB credential)
   →  redeem seed token  →  treasury.credit()  →  launch (provision Q via FROST
   keyset ceremony + spawn tenant)  →  OP_ACK spawned    (losers of the lease drop)
```
Authorization precedes funding precedes spawn. If no node has capacity the command
goes unclaimed → **silence + client timeout** (turtle agreed: no coordinator for v0;
the UI shows "pending" and offers retry).

---

## 7. UI work (gudnuf's lane, this repo)

Built on the existing architecture (`useCluster` owns the relay via `SimplePool`;
add a publish/sign path alongside it).

1. **`useNostrAuth` hook** — login methods from §2, exposes `npub`, `signEvent`,
   `logout`, and an `isSigner` flag (read-only sessions can't command).
2. **`<NostrLogin>` modal** — the tiered method picker + back-up-key + import flows.
3. **`useOperatorCommands` hook** — builds, confirms, signs, and publishes `OP_CREATE`
   / `OP_FUND`; subscribes to `OP_ACK` by `nonce`; surfaces pending → acked → live.
4. **Token source** — **the human pastes both tokens** (gudnuf, 2026-06-24): a money
   `cashuA…` **seed token** and a `cashuB…` **PoP credential**, minted out-of-band (pops
   CLI for the PoP). No built-in wallet in v0; paste fields validated client-side (each
   decodes as the expected Cashu token type) before the confirm step.
5. **Create-agent form** — mission + seed token + pop token. Shows what's being spent
   (seed) and the power being proven (pop) in the confirm step.
6. **"Your agents" view** — filter `31000`/`9100` by the creator `["p", npub]` tag;
   each card gets a **Top up** action (the `OP_FUND` flow).
7. **Logged-out** = today's read-only dashboard, unchanged.

---

## 8. Split of work

**UI / gudnuf (this repo, local now):** §2 login, §7 all. No protocol authority —
consumes the kinds keeper:kirby-nostr ratifies.

**Node / turtle (kirby-node):** §4 ratify kinds + add creator tag to 9100/31000;
§5 inbound ecash redeem + `treasury.credit()`; §6 claim/lease on `OP_CREATE`; emit
`OP_ACK`; subscribe to the command kinds in the Fleet-host supervisor (#35).

**Shared / keeper:kirby-nostr:** the event-kind contract update (§4) is the
coordination point — UI and node must agree on kinds, tags, and content before either
ships its half.

---

## 9. Resolved by turtle (2026-06-25) + items left for gudnuf

**Answered by turtle** (folded into the sections above):
- **PoP** = the `pops` project: a `cashuB` credential backed by CLTV-locked BTC; node
  verifies by swapping/consuming it; **gates `OP_CREATE` only**; human pastes it (§3).
- **Three keys**; agent identity is its own FROST `Q` provisioned at spawn; creator is a
  `["p", operator]` **tag** (§1, §4).
- **Inbound redeem + `treasury.credit()` is net-new**, shared with the earn loop (#6);
  node is "deaf" today, command subscriber is net-new too (§5, §6).
- **Claim** via #35 `LeaseAuthority`; **no-capacity = silence + client timeout** (§6).
- **Mission** = untrusted free text → node sanitizes + bounds before boot (§4.1).
- **Reconcile `OP_CREATE`** with the existing "spawn-request event" concept (keeper:kirby-nostr).

**Left for gudnuf to set (numbers/policy):**
1. **Required PoP power-amount** — the minimum locked sats a `create` must prove
   (the spam cost). _________
2. **Minimum seed amount** — the floor that clears the agent death-floor and buys a
   viable runway (node-policy config). _________
3. **Confirm: PoP gates CREATE only** (not top-up). turtle recommends yes. → _________
4. **`OP_CREATE` ↔ spawn-request reconciliation** — settle with keeper:kirby-nostr so
   there's one spawn concept, then lock the kind numbers.

---

## 10. Phasing

- **P0 (local, no node dep):** §2 login + confirm-before-sign, rendered in the Header;
  read-only dashboard unchanged. Ships immediately, demoable solo.
- **P1 (needs §4 kinds ratified):** create-agent form + `OP_CREATE` publish + ack
  handling + "your agents" filter. Pairs with turtle's §5/§6 node work.
- **P2:** top-up (`OP_FUND`).
- **P3 / later:** built-in Cashu wallet UX (drop the paste step); multi-mint.
