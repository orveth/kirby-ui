// The auth React binding: a context that owns the operator session on top of the
// verified auth core (auth.ts / signer.ts / session.ts).
//
// Session states:
//   anon   — logged out (the default; the dashboard stays fully usable read-only)
//   locked — a stored local/imported key exists; needs the passphrase to unlock
//   authed — a signer is held in memory; commands can be signed
//
// Secret keys live ONLY in a ref while authed and are dropped on logout. Signing is
// gated: signEvent() raises a confirmation the user must approve (a signed event
// here is a real command), wired through the <ConfirmSign> modal that reads this
// context.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";

import { generateAccount, importKey, encryptSecret, decryptSecret } from "./auth";
import { localSigner, nip07Signer, detectNip07, type EventTemplate, type Signer } from "./signer";
import { saveSession, loadSession, clearSession, type StoredSession } from "./session";
import type { BuiltDm, DmRumor } from "./dm";

type AuthStatus = "anon" | "locked" | "authed";

/** A signature the user has been asked to approve before it is signed. */
export interface PendingSign {
  template: EventTemplate;
  /** Human summary of what this signature authorizes (shown in the confirm UI). */
  summary: string;
  approve: () => void;
  reject: () => void;
}

export interface NostrAuth {
  status: AuthStatus;
  npub: string | null;
  /** The operator's hex pubkey while authed (for the DM subscription filter), else null. */
  pubkey: string | null;
  method: StoredSession["method"] | null;
  nip07Available: boolean;
  /** Whether the current session can send/read NIP-17 DMs (see Signer.canDm). */
  canDm: boolean;

  /** Sign in with the NIP-07 browser extension. */
  loginNip07: () => Promise<void>;
  /** Generate a fresh key, persist it NIP-49-encrypted, and sign in. */
  createAccount: (passphrase: string) => Promise<{ npub: string; ncryptsec: string }>;
  /** Import an nsec/ncryptsec/hex key; persist it encrypted under `savePassphrase`. */
  importAccount: (input: string, importPassphrase: string | undefined, savePassphrase: string) => Promise<void>;
  /** Decrypt the stored key with the passphrase to leave the `locked` state. */
  unlock: (passphrase: string) => Promise<void>;
  /** Drop the in-memory key and the stored session. */
  logout: () => void;

  /** Request a confirmed signature. Resolves once the user approves, rejects on cancel. */
  signEvent: (template: EventTemplate, summary: string) => Promise<NostrEvent>;
  /** The signature awaiting confirmation, if any (drives <ConfirmSign>). */
  pendingSign: PendingSign | null;

  /** Build a NIP-17 DM to `agentPubkey` (+ self-copy). Frictionless (no ConfirmSign):
   *  a gift wrap can only ever produce a DM, never a spawn/fund command. */
  buildDm: (agentPubkey: string, message: string) => Promise<BuiltDm>;
  /** Open a gift wrap addressed to us into its seal-verified inner message. */
  openDm: (giftWrap: NostrEvent) => Promise<DmRumor>;
}

const AuthContext = createContext<NostrAuth | null>(null);

export function NostrAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useProvideAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** Read the auth context. Throws if used outside the provider. */
export function useNostrAuth(): NostrAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useNostrAuth must be used within <NostrAuthProvider>");
  return ctx;
}

function useProvideAuth(): NostrAuth {
  const [status, setStatus] = useState<AuthStatus>("anon");
  const [npub, setNpub] = useState<string | null>(null);
  const [method, setMethod] = useState<StoredSession["method"] | null>(null);
  const [pendingSign, setPendingSign] = useState<PendingSign | null>(null);

  // The active signer (and, for local sessions, the secret key) live only here —
  // never in React state, never persisted in the clear.
  const signerRef = useRef<Signer | null>(null);
  const storedNcryptsecRef = useRef<string | null>(null);

  const nip07Available = typeof window !== "undefined" && detectNip07(window);

  // On mount, restore a prior session: a NIP-07 session reconnects to the
  // extension; a local/imported session enters `locked` until unlocked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = loadSession(window.localStorage);
    if (!stored) return;
    setMethod(stored.method);
    setNpub(stored.npub);
    if (stored.method === "nip07") {
      nip07Signer(window)
        .then((s) => {
          signerRef.current = s;
          setStatus("authed");
        })
        .catch(() => {
          // extension gone/denied — fall back to logged-out
          clearSession(window.localStorage);
          setStatus("anon");
          setNpub(null);
          setMethod(null);
        });
    } else {
      storedNcryptsecRef.current = stored.ncryptsec;
      setStatus("locked");
    }
  }, []);

  const loginNip07 = useCallback(async () => {
    const signer = await nip07Signer(window);
    signerRef.current = signer;
    const np = npubEncode(signer.pubkey);
    saveSession(window.localStorage, { method: "nip07", npub: np });
    setMethod("nip07");
    setNpub(np);
    setStatus("authed");
  }, []);

  const adoptLocalKey = useCallback((sk: Uint8Array, np: string, ncryptsec: string, m: "local" | "imported") => {
    signerRef.current = localSigner(sk);
    storedNcryptsecRef.current = ncryptsec;
    saveSession(window.localStorage, { method: m, npub: np, ncryptsec });
    setMethod(m);
    setNpub(np);
    setStatus("authed");
  }, []);

  const createAccount = useCallback(
    async (passphrase: string) => {
      const acct = generateAccount();
      const ncryptsec = encryptSecret(acct.sk, passphrase);
      adoptLocalKey(acct.sk, acct.npub, ncryptsec, "local");
      return { npub: acct.npub, ncryptsec };
    },
    [adoptLocalKey],
  );

  const importAccount = useCallback(
    async (input: string, importPassphrase: string | undefined, savePassphrase: string) => {
      const acct = importKey(input, importPassphrase);
      const ncryptsec = encryptSecret(acct.sk, savePassphrase);
      adoptLocalKey(acct.sk, acct.npub, ncryptsec, "imported");
    },
    [adoptLocalKey],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const ncryptsec = storedNcryptsecRef.current;
    if (!ncryptsec) throw new Error("nothing to unlock");
    const sk = decryptSecret(ncryptsec, passphrase); // throws on wrong passphrase
    signerRef.current = localSigner(sk);
    setStatus("authed");
  }, []);

  const logout = useCallback(() => {
    signerRef.current = null;
    storedNcryptsecRef.current = null;
    if (typeof window !== "undefined") clearSession(window.localStorage);
    setStatus("anon");
    setNpub(null);
    setMethod(null);
    setPendingSign(null);
  }, []);

  const signEvent = useCallback(
    (template: EventTemplate, summary: string) =>
      new Promise<NostrEvent>((resolve, reject) => {
        const signer = signerRef.current;
        if (!signer) {
          reject(new Error("not signed in"));
          return;
        }
        setPendingSign({
          template,
          summary,
          approve: () => {
            setPendingSign(null);
            signer.signEvent(template).then(resolve, reject);
          },
          reject: () => {
            setPendingSign(null);
            reject(new Error("signature cancelled"));
          },
        });
      }),
    [],
  );

  // DMs go straight to the signer (no ConfirmSign): the gift-wrap structure is fixed,
  // so the operator key can only ever produce a DM here, never a command.
  const buildDm = useCallback((agentPubkey: string, message: string) => {
    const signer = signerRef.current;
    if (!signer) return Promise.reject(new Error("not signed in"));
    if (!signer.canDm) return Promise.reject(new Error("this session cannot send DMs"));
    return signer.buildDm(agentPubkey, message);
  }, []);

  const openDm = useCallback((giftWrap: NostrEvent) => {
    const signer = signerRef.current;
    if (!signer) return Promise.reject(new Error("not signed in"));
    return signer.openDm(giftWrap);
  }, []);

  // Read off the live signer; both flip when `status` does, so they re-render correctly.
  const signer = signerRef.current;
  const pubkey = status === "authed" && signer ? signer.pubkey : null;
  const canDm = status === "authed" && signer ? signer.canDm : false;

  return useMemo(
    () => ({
      status,
      npub,
      pubkey,
      method,
      nip07Available,
      canDm,
      loginNip07,
      createAccount,
      importAccount,
      unlock,
      logout,
      signEvent,
      pendingSign,
      buildDm,
      openDm,
    }),
    [status, npub, pubkey, method, nip07Available, canDm, loginNip07, createAccount, importAccount, unlock, logout, signEvent, pendingSign, buildDm, openDm],
  );
}
