// The control-plane "create agent" action: build, sign, and publish a KIND 31003
// spawn request. A Kirby node with capacity that allowlists the signer's pubkey
// verifies it and spawns the agent — this is a pure Nostr client write, no backend.
//
// The SIGNER's pubkey is the authorization identity: a node only spawns if that key
// is in its operator allowlist (or it runs open), so the confirmation screen prints
// the operator pubkey (hex) to add to a node. We do NOT read the 31003 back to claim
// success (it's intent, not truth) — we watch for the agent's real born/presence/
// state events via the dashboard, surfaced here as a live "waiting → alive" check.

import { useState } from "react";
import { decode } from "nostr-tools/nip19";
import { useNostrAuth } from "../nostr/useNostrAuth";
import {
  buildSpawnRequestTemplate,
  validateAgentId,
  validateSeedSats,
  validateImageRef,
} from "../nostr/spawnRequest";

/** A build-time default staged image, if a deploy sets one (else the field starts
 *  empty and the operator pastes the ref their node pre-staged). */
const DEFAULT_IMAGE_REF: string = import.meta.env.VITE_SPAWN_IMAGE_REF ?? "";
const DEFAULT_SEED_SATS = 50_000;

interface CreateAgentProps {
  /** Publish a signed event to the relay (from useCluster). */
  publish: (ev: import("nostr-tools").Event) => Promise<void>;
  /** True once the agent_id is observable as a live agent (born/state arrived). */
  isSpawned: (agentId: string) => boolean;
}

/** npub (bech32) -> 32-byte hex pubkey, or "" if it can't be decoded. */
function npubToHex(npub: string | null): string {
  if (!npub) return "";
  try {
    const d = decode(npub);
    return d.type === "npub" ? (d.data as string) : "";
  } catch {
    return "";
  }
}

export function CreateAgent({ publish, isSpawned }: CreateAgentProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="auth-btn create-agent-btn" onClick={() => setOpen(true)}>
        + new agent
      </button>
      {open && <CreateModal publish={publish} isSpawned={isSpawned} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateModal({
  publish,
  isSpawned,
  onClose,
}: CreateAgentProps & { onClose: () => void }) {
  const { status, npub, signEvent } = useNostrAuth();
  const authed = status === "authed";
  const operatorHex = npubToHex(npub);

  const [agentId, setAgentId] = useState("");
  const [seedStr, setSeedStr] = useState(String(DEFAULT_SEED_SATS));
  const [imageRef, setImageRef] = useState(DEFAULT_IMAGE_REF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const seedSats = Number(seedStr);
  const idErr = agentId.length > 0 ? validateAgentId(agentId) : null;
  const seedErr = seedStr.length > 0 ? validateSeedSats(seedSats) : null;
  const imgErr = imageRef.length > 0 ? validateImageRef(imageRef) : null;
  const ready =
    authed &&
    agentId.length > 0 &&
    imageRef.trim().length > 0 &&
    seedStr.length > 0 &&
    !idErr &&
    !seedErr &&
    !imgErr;

  const submit = async () => {
    setError(null);
    const built = buildSpawnRequestTemplate({
      agentId,
      imageRef: imageRef.trim(),
      seedSats,
      requesterPubkey: operatorHex,
      createdAt: Math.floor(Date.now() / 1000),
    });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      const signed = await signEvent(
        built.template,
        `Create agent “${agentId}” — fund ${seedSats.toLocaleString()} sats, image ${imageRef.trim()}`,
      );
      await publish(signed);
      setSubmittedId(agentId);
    } catch (e) {
      setError((e as Error)?.message ?? "could not publish the spawn request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Create agent" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <h2>{submittedId ? "Spawn requested" : "Create agent"}</h2>
          <button type="button" className="auth-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {submittedId ? (
          <SubmittedScreen agentId={submittedId} operatorHex={operatorHex} live={isSpawned(submittedId)} onClose={onClose} />
        ) : (
          <div className="auth-form">
            {!authed && (
              <p className="auth-help auth-warn">
                Sign in first (top-right) — the spawn request is signed by your key, and a node only spawns for keys it
                allowlists.
              </p>
            )}

            <label>Agent id</label>
            <input
              className="mono"
              value={agentId}
              autoFocus
              placeholder="chatter-1"
              onChange={(e) => setAgentId(e.target.value)}
            />
            {idErr && <p className="auth-error">{idErr}</p>}

            <label>Seed treasury (sats)</label>
            <input
              className="mono"
              inputMode="numeric"
              value={seedStr}
              onChange={(e) => setSeedStr(e.target.value.replace(/[^0-9]/g, ""))}
            />
            {seedErr && <p className="auth-error">{seedErr}</p>}

            <label>Image ref</label>
            <input
              className="mono"
              value={imageRef}
              placeholder="the image your node pre-staged"
              onChange={(e) => setImageRef(e.target.value)}
            />
            {imgErr && <p className="auth-error">{imgErr}</p>}

            <p className="auth-fine">
              Funding is declarative (deposit-and-meter) — no token travels on the relay. The node re-validates and only
              spawns if your key is allowlisted.
            </p>

            {error && <p className="auth-error">{error}</p>}

            <button type="button" className="auth-submit" disabled={!ready || busy} onClick={submit}>
              {busy ? "Publishing…" : "Sign & publish spawn request"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmittedScreen({
  agentId,
  operatorHex,
  live,
  onClose,
}: {
  agentId: string;
  operatorHex: string;
  live: boolean;
  onClose: () => void;
}) {
  return (
    <div className="auth-form">
      <p className="auth-help">
        Published a spawn request for <strong className="mono">{agentId}</strong>. A node that allowlists your key will
        provision and launch it.
      </p>

      <div className={`spawn-status${live ? " spawn-status--live" : ""}`}>
        <span className="spawn-status-dot" aria-hidden="true" />
        {live ? (
          <span>
            <strong>Alive.</strong> {agentId} is reporting in — see its card on the dashboard.
          </span>
        ) : (
          <span>Waiting for it to come alive (born → presence → state). There may be a brief boot gap.</span>
        )}
      </div>

      <label>Your operator pubkey (add to a node&apos;s allowlist)</label>
      <input
        className="mono"
        readOnly
        value={operatorHex}
        onFocus={(e) => e.currentTarget.select()}
      />
      <p className="auth-fine">
        A node only spawns for keys in its operator allowlist (or one running open). Give this hex to the node operator
        to authorize you.
      </p>

      <button type="button" className="auth-submit" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
