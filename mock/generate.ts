// The Kirby mock-event generator.
//
// Stands in for the cluster's daemons until keeper:kirby-nostr's real publisher
// is wired, so the UI is buildable + demoable today. It SIGNS events with per-node
// BIP340 keys and publishes them to a Nostr relay in the EXACT wire shape locked
// with the publisher (plans/kirby-cluster-event-kinds-20260619.md), so mock==real:
// the UI cannot tell these from the daemon's output (same kinds, tags, sigs).
//
// Run (relay must be up - see `npm run relay`):
//   bun mock/generate.ts                  # full demo: every kind, looping story
//   bun mock/generate.ts --honest         # only the REAL-NOW kinds (10100/21000/9100)
//   bun mock/generate.ts --relay ws://host:7777
//   KIRBY_RELAY=ws://host:7777 bun mock/generate.ts
//
// While running, type commands + Enter: kill <n> | revive <n> | rug | quorum |
// earn <agent> | die <agent> | help | quit.
//
// Node 24 / bun both provide a global WebSocket, so nostr-tools' relay client
// works with no polyfill.

import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { npubEncode } from "nostr-tools/nip19";

// --- the contract (kept in lockstep with src/nostr/kinds.ts) ----------------
const KIND = {
  NOTE: 1, // the agent's own public voice — a real kind:1 Nostr note
  PRESENCE: 10100,
  AGENT_STATE: 31000,
  METER_TICK: 21000,
  LIFECYCLE: 9100,
  LEDGER: 9101,
  FAILOVER: 9102,
  CUSTODY: 9103,
} as const;

type Backend = "firecracker" | "vz";

// --- args / config ----------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const RELAY = argValue("--relay") ?? process.env.KIRBY_RELAY ?? "ws://127.0.0.1:7777";
const HONEST = argv.includes("--honest"); // publish only the real-now kinds
const NO_LOOP = argv.includes("--no-loop");

const PRESENCE_INTERVAL_MS = 5_000;
const METER_INTERVAL_MS = 1_500;
const STATE_INTERVAL_MS = 5_000;
const BURN_PER_STATE = 40; // sats burned per 31000 tick (the rent metabolism)

const now = () => Math.floor(Date.now() / 1000);

// --- node identities (deterministic from a seed -> stable npubs per run) ----
function skFromSeed(seed: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`kirby-mock:${seed}`).digest());
}

interface MockNode {
  id: string;
  backend: Backend;
  sk: Uint8Array;
  pk: string;
  npub: string;
  alive: boolean;
  startedAt: number;
}

function mkNode(id: string, backend: Backend): MockNode {
  const sk = skFromSeed(id);
  const pk = getPublicKey(sk);
  return { id, backend, sk, pk, npub: npubEncode(pk), alive: true, startedAt: now() };
}

const nodes: Record<string, MockNode> = {
  "node-1": mkNode("node-1", "firecracker"),
  "node-2": mkNode("node-2", "firecracker"),
  "node-3": mkNode("node-3", "vz"),
};

const fidelityOf = (backend: Backend) => (backend === "vz" ? "host_coarse" : "cgroup_exact");

// --- agents (failover-stable ids; the holder node can change) ---------------
interface MockAgent {
  id: string;
  holder: string; // node id currently running it
  backend: Backend;
  treasury: number;
  born: boolean;
  dead: boolean;
  leaseTerm: number;
}

const agents: Record<string, MockAgent> = {
  "agent-0": { id: "agent-0", holder: "node-1", backend: "firecracker", treasury: 8_000, born: false, dead: false, leaseTerm: 1 },
  "agent-1": { id: "agent-1", holder: "node-2", backend: "firecracker", treasury: 5_200, born: false, dead: false, leaseTerm: 1 },
  "agent-2": { id: "agent-2", holder: "node-3", backend: "vz", treasury: 12_000, born: false, dead: false, leaseTerm: 1 },
};

// --- publishing -------------------------------------------------------------
const pool = new SimplePool();
const tags = (...t: string[][]) => t;

async function publish(nodeId: string, kind: number, content: object, extraTags: string[][]) {
  const node = nodes[nodeId];
  if (!node) return;
  const evt = finalizeEvent(
    {
      kind,
      created_at: now(),
      tags: [["t", "kirby"], ...extraTags],
      content: JSON.stringify(content),
    },
    node.sk,
  );
  try {
    await Promise.any(pool.publish([RELAY], evt));
  } catch (e) {
    console.error(`  ! publish failed (kind ${kind}, ${nodeId}):`, (e as Error)?.message ?? e);
  }
}

// kind:1 notes carry PLAIN-TEXT content (not JSON), so they bypass the JSON
// publish() helper. Signed by the holder node's key, tagged ["a",agent_id] so the
// UI can attribute the note to its failover-stable agent (same as real publisher).
async function publishNote(nodeId: string, text: string, agentId: string) {
  const node = nodes[nodeId];
  if (!node) return;
  const evt = finalizeEvent(
    {
      kind: KIND.NOTE,
      created_at: now(),
      tags: [["t", "kirby"], ["a", agentId], ["node", nodeId]],
      content: text,
    },
    node.sk,
  );
  try {
    await Promise.any(pool.publish([RELAY], evt));
  } catch (e) {
    console.error(`  ! note publish failed (${nodeId}):`, (e as Error)?.message ?? e);
  }
}

// --- per-kind emitters (the locked envelopes) -------------------------------
async function emitPresence(node: MockNode) {
  await publish(
    node.id,
    KIND.PRESENCE,
    { node_id: node.id, status: "alive", started_at: node.startedAt, version: "0.1.0-mock" },
    tags(["node", node.id]),
  );
}

async function emitMeter(agent: MockAgent) {
  const node = nodes[agent.holder];
  if (!node || !node.alive) return;
  // A little life in the needles: cpu wanders, mem drifts, egress mostly idle.
  const cpu = +(2 + Math.abs(Math.sin(now() / 7 + agent.id.length)) * 22).toFixed(1);
  const mem = 40 + Math.round(Math.abs(Math.sin(now() / 11)) * 30);
  const egress = Math.random() < 0.2 ? Math.round(Math.random() * 4000) : 0;
  await publish(
    agent.holder,
    KIND.METER_TICK,
    { agent_id: agent.id, cpu_pct: cpu, mem_mib: mem, egress_bps: egress, fidelity: fidelityOf(node.backend) },
    tags(["a", agent.id], ["node", agent.holder]),
  );
}

async function emitAgentState(agent: MockAgent) {
  const lifecycle = agent.dead ? "dead" : agent.born ? "running" : "born";
  await publish(
    agent.holder,
    KIND.AGENT_STATE,
    {
      agent_id: agent.id,
      treasury_sats: agent.treasury,
      runway_secs: Math.max(0, Math.round((agent.treasury / BURN_PER_STATE) * (STATE_INTERVAL_MS / 1000))),
      lifecycle,
      lease_holder_node: agent.holder,
      lease_term: agent.leaseTerm,
      backend: agent.backend,
    },
    tags(["a", agent.id], ["node", agent.holder], ["d", agent.id]), // d-tag: addressable per agent
  );
}

async function emitLifecycle(agent: MockAgent, event: "born" | "died", reason: "funded" | "broke") {
  await publish(
    agent.holder,
    KIND.LIFECYCLE,
    { agent_id: agent.id, event, treasury_sats: agent.treasury, reason },
    tags(["a", agent.id], ["node", agent.holder]),
  );
}

async function emitLedger(agent: MockAgent, kind: "earn" | "spend", amount: number, act: string) {
  if (HONEST) return; // 9101 is pending in the real publisher
  await publish(
    agent.holder,
    KIND.LEDGER,
    { agent_id: agent.id, kind, amount_sats: amount, act, balance_after: agent.treasury },
    tags(["a", agent.id], ["node", agent.holder]),
  );
}

async function emitFailover(agent: MockAgent, fromNode: string, toNode: string) {
  if (HONEST) return; // 9102 is pending in the real publisher
  await publish(
    toNode,
    KIND.FAILOVER,
    { agent_id: agent.id, from_node: fromNode, to_node: toNode, term: agent.leaseTerm, restored: "snapshot" },
    tags(["a", agent.id], ["node", toNode]),
  );
}

async function emitCustody(agent: MockAgent, event: "single_node_spend_refused" | "quorum_signed", detail: string) {
  if (HONEST) return; // 9103 is pending (FROST/quorum not yet wired)
  await publish(
    agent.holder,
    KIND.CUSTODY,
    { agent_id: agent.id, event, detail },
    tags(["a", agent.id], ["node", agent.holder]),
  );
}

// --- scenario actions -------------------------------------------------------
async function bornIfNeeded(agent: MockAgent) {
  if (agent.born || agent.dead) return;
  agent.born = true;
  await emitLifecycle(agent, "born", "funded");
  console.log(`  + ${agent.id} BORN on ${agent.holder} (funded ${agent.treasury} sats)`);
}

async function killNode(n: number) {
  const id = `node-${n}`;
  const node = nodes[id];
  if (!node || !node.alive) return;
  node.alive = false;
  console.log(`  x KILLED ${id} - it will go STALE (its presence beacon stops)`);
}

async function reviveNode(n: number) {
  const id = `node-${n}`;
  const node = nodes[id];
  if (!node || node.alive) return;
  node.alive = true;
  node.startedAt = now();
  await emitPresence(node);
  console.log(`  ^ REVIVED ${id} - presence resumes, returns ALIVE`);
}

async function failover(agentId: string, toNode: string) {
  const agent = agents[agentId];
  if (!agent || agent.dead) return;
  const from = agent.holder;
  if (from === toNode) return;
  agent.leaseTerm += 1;
  agent.holder = toNode;
  agent.backend = nodes[toNode].backend;
  await emitFailover(agent, from, toNode);
  await emitAgentState(agent); // new holder publishes the fresh 31000 (freshest-wins)
  console.log(`  > FAILOVER ${agentId}: ${from} -> ${toNode} (term ${agent.leaseTerm}); agent survived`);
}

async function earn(agentId: string, amount: number) {
  const agent = agents[agentId];
  if (!agent || agent.dead) return;
  agent.treasury += amount;
  await emitLedger(agent, "earn", amount, "served inference");
  await emitAgentState(agent);
  console.log(`  $ ${agentId} EARNED +${amount} sats (now ${agent.treasury})`);
}

// The agent CHOOSES to post a public note — its outward voice (the POST actuator).
const NOTE_LINES = [
  "Hello world! I'm awake and earning my keep.",
  "Just served some inference. Treasury's looking healthy. ⚡",
  "I think, therefore I bill.",
  "Survived a failover and didn't lose a single sat.",
  "Anyone need a thought thought? First one's on me.",
];
async function chatter(agentId: string, text?: string) {
  const agent = agents[agentId];
  if (!agent || agent.dead) return;
  const line = text ?? NOTE_LINES[Math.floor(Math.random() * NOTE_LINES.length)];
  await publishNote(agent.holder, line, agent.id);
  console.log(`  💬 ${agentId} POSTED a note: "${line}"`);
}

async function rugRefused(agentId: string) {
  const agent = agents[agentId];
  if (!agent) return;
  await emitCustody(agent, "single_node_spend_refused", `${agent.holder} attempted a solo spend; 2-of-3 quorum refused`);
  console.log(`  ! RUG ATTEMPT on ${agentId} REFUSED (single-node spend rejected by quorum)`);
}

async function quorumSpend(agentId: string) {
  const agent = agents[agentId];
  if (!agent) return;
  await emitCustody(agent, "quorum_signed", "2-of-3 guardians co-signed a withdrawal (taproot key-path)");
  console.log(`  = ${agentId} QUORUM SPEND co-signed (legit, 2-of-3)`);
}

async function die(agentId: string, reason: "broke" | "funded" = "broke") {
  const agent = agents[agentId];
  if (!agent || agent.dead) return;
  agent.dead = true;
  agent.treasury = Math.max(0, agent.treasury);
  await emitLifecycle(agent, "died", reason);
  await emitAgentState(agent);
  console.log(`  + ${agentId} DIED (${reason}) - the reaper claimed it`);
}

// --- the periodic loops -----------------------------------------------------
function startLoops() {
  setInterval(() => {
    for (const node of Object.values(nodes)) if (node.alive) void emitPresence(node);
  }, PRESENCE_INTERVAL_MS);

  setInterval(() => {
    for (const agent of Object.values(agents)) if (agent.born && !agent.dead) void emitMeter(agent);
  }, METER_INTERVAL_MS);

  if (!HONEST) {
    setInterval(() => {
      for (const agent of Object.values(agents)) {
        if (!agent.born || agent.dead) continue;
        // Burn rent; an agent that runs dry dies (the earn-or-die metabolism).
        agent.treasury -= BURN_PER_STATE;
        if (agent.treasury <= 0) void die(agent.id, "broke");
        else void emitAgentState(agent);
      }
    }, STATE_INTERVAL_MS);
  }
}

// --- the self-narrating demo timeline (loops unless --no-loop) --------------
async function runTimeline() {
  const step = async (label: string, ms: number, fn: () => Promise<void> | void) => {
    await new Promise((r) => setTimeout(r, ms));
    if (label) console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}`);
    await fn();
  };

  do {
    await step("nodes alive, agents being born...", 500, async () => {
      for (const node of Object.values(nodes)) if (node.alive) await emitPresence(node);
      for (const agent of Object.values(agents)) await bornIfNeeded(agent);
    });
    await step("agent-0 posts a note (its own voice)", 4_000, () => chatter("agent-0", "Hello world! I'm awake and earning my keep."));
    await step("agent-0 earns (served inference)", 8_000, () => earn("agent-0", 2_500));
    await step("RUG ATTEMPT on agent-1 (single-node spend) -> refused", 8_000, () => rugRefused("agent-1"));
    await step("KILL node-2 (the node running agent-1)", 8_000, () => killNode(2));
    await step("FAILOVER agent-1 to node-1 (survives the kill)", 6_000, () => failover("agent-1", "node-1"));
    await step("QUORUM SPEND on agent-2 (2-of-3, legit)", 10_000, () => quorumSpend("agent-2"));
    await step("REVIVE node-2 (rejoins ALIVE)", 8_000, () => reviveNode(2));
    await step("agent-2 posts a note (its own voice)", 6_000, () => chatter("agent-2", "Survived a failover and didn't lose a single sat."));
    await step("agent-0 earns again", 6_000, () => earn("agent-0", 1_800));
  } while (!NO_LOOP);
}

// --- manual control over stdin ----------------------------------------------
function startStdin() {
  const rl = createInterface({ input: process.stdin });
  console.log("\ncommands: note <agent> [text] | kill <n> | revive <n> | rug [agent] | quorum [agent] | earn <agent> [sats] | die <agent> | help | quit\n");
  rl.on("line", (line) => {
    const trimmed = line.trim();
    const [cmd, a, b] = trimmed.split(/\s+/);
    switch (cmd) {
      case "note": case "say": {
        // `note <agent> [free text...]` — the rest of the line is the note body.
        const agent = a ?? "agent-0";
        const rest = trimmed.slice(trimmed.indexOf(agent) + agent.length).trim();
        void chatter(agent, rest || undefined);
        break;
      }
      case "kill": void killNode(Number(a)); break;
      case "revive": void reviveNode(Number(a)); break;
      case "rug": void rugRefused(a ?? "agent-1"); break;
      case "quorum": void quorumSpend(a ?? "agent-2"); break;
      case "earn": void earn(a ?? "agent-0", Number(b) || 1_000); break;
      case "die": void die(a ?? "agent-1"); break;
      case "fail": void failover(a ?? "agent-1", b ?? "node-1"); break;
      case "help": case "?":
        console.log("note <agent> [text] | kill <n> | revive <n> | rug [agent] | quorum [agent] | earn <agent> [sats] | die <agent> | fail <agent> <node> | quit");
        break;
      case "quit": case "exit": cleanup(); break;
      case "": break;
      default: console.log(`unknown: ${cmd} (try 'help')`);
    }
  });
}

function cleanup() {
  console.log("\nshutting down mock generator...");
  try { pool.close([RELAY]); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", cleanup);

// --- main -------------------------------------------------------------------
console.log(`kirby mock generator -> relay ${RELAY}  [mode: ${HONEST ? "HONEST (real-now kinds only)" : "FULL demo"}]`);
console.log(`nodes:`);
for (const n of Object.values(nodes)) console.log(`  ${n.id} (${n.backend})  ${n.npub}`);
startLoops();
startStdin();
void runTimeline();
