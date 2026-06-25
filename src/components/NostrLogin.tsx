// The login control: a header chip (signed-in npub + logout, or a "Sign in" button)
// plus the tiered login modal. Methods, in the order the modal offers them:
//   1. NIP-07 browser extension   (preferred — keys never enter the app)
//   2. Create a key locally        (new users; stored NIP-49-encrypted)
//   3. Import an existing key       (advanced — nsec / ncryptsec)
// A returning local/imported session lands in `locked` and just needs its passphrase.

import { useState } from "react";
import { useNostrAuth } from "../nostr/useNostrAuth";
import { shortNpub } from "../nostr/verify";

export function LoginControl() {
  const { status, npub } = useNostrAuth();
  const [open, setOpen] = useState(false);

  if (status === "authed" && npub) {
    return <Identity />;
  }

  return (
    <>
      <button type="button" className="auth-btn" onClick={() => setOpen(true)}>
        {status === "locked" ? "Unlock" : "Sign in"}
      </button>
      {open && <LoginModal onClose={() => setOpen(false)} />}
    </>
  );
}

function Identity() {
  const { npub, method, logout } = useNostrAuth();
  return (
    <div className="auth-id" title={npub ?? undefined}>
      <span className="auth-id-dot" aria-hidden="true" />
      <span className="auth-id-npub mono">{npub ? shortNpub(npub) : ""}</span>
      {method && <span className="auth-id-method">{method === "nip07" ? "extension" : method}</span>}
      <button type="button" className="auth-id-out" onClick={logout} title="sign out">
        ⏻
      </button>
    </div>
  );
}

type Screen = "choose" | "create" | "create-backup" | "import" | "unlock";

function LoginModal({ onClose }: { onClose: () => void }) {
  const auth = useNostrAuth();
  const [screen, setScreen] = useState<Screen>(auth.status === "locked" ? "unlock" : "choose");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message ?? "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign in" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <h2>{TITLES[screen]}</h2>
          <button type="button" className="auth-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {error && <p className="auth-error">{error}</p>}

        {screen === "choose" && <ChooseScreen auth={auth} go={setScreen} run={run} busy={busy} done={onClose} />}
        {screen === "create" && (
          <CreateScreen run={run} busy={busy} onCreated={() => setScreen("create-backup")} create={auth.createAccount} />
        )}
        {screen === "create-backup" && <BackupScreen npub={auth.npub} onDone={onClose} />}
        {screen === "import" && <ImportScreen run={run} busy={busy} importAccount={auth.importAccount} done={onClose} />}
        {screen === "unlock" && <UnlockScreen run={run} busy={busy} unlock={auth.unlock} done={onClose} />}

        {screen !== "choose" && screen !== "create-backup" && auth.status !== "locked" && (
          <button type="button" className="auth-link" onClick={() => setScreen("choose")} disabled={busy}>
            ← other methods
          </button>
        )}
      </div>
    </div>
  );
}

const TITLES: Record<Screen, string> = {
  choose: "Sign in",
  create: "Create a key",
  "create-backup": "Back up your key",
  import: "Import a key",
  unlock: "Unlock",
};

function ChooseScreen({
  auth,
  go,
  run,
  busy,
  done,
}: {
  auth: ReturnType<typeof useNostrAuth>;
  go: (s: Screen) => void;
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  done: () => void;
}) {
  return (
    <div className="auth-choices">
      <button
        type="button"
        className="auth-method auth-method--primary"
        disabled={busy || !auth.nip07Available}
        onClick={() => run(async () => { await auth.loginNip07(); done(); })}
      >
        <strong>Use browser extension</strong>
        <span className="auth-method-sub">
          {auth.nip07Available ? "Detected — keys never leave the extension" : "No extension found (Alby, nos2x)"}
        </span>
      </button>

      <button type="button" className="auth-method" disabled={busy} onClick={() => go("create")}>
        <strong>I&apos;m new — create a key</strong>
        <span className="auth-method-sub">Generated in your browser, encrypted at rest</span>
      </button>

      <button type="button" className="auth-method auth-method--muted" disabled={busy} onClick={() => go("import")}>
        <strong>Import existing key</strong>
        <span className="auth-method-sub">Advanced — paste an nsec or ncryptsec</span>
      </button>
    </div>
  );
}

function CreateScreen({
  run,
  busy,
  create,
  onCreated,
}: {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  create: ReturnType<typeof useNostrAuth>["createAccount"];
  onCreated: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw2.length > 0 && pw !== pw2;

  return (
    <div className="auth-form">
      <p className="auth-help">
        Choose a passphrase. Your new key is encrypted with it before it&apos;s stored — we never keep it in the clear.
      </p>
      <label>Passphrase</label>
      <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} />
      <label>Confirm passphrase</label>
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {mismatch && <p className="auth-error">Passphrases don&apos;t match.</p>}
      <button
        type="button"
        className="auth-submit"
        disabled={busy || pw.length < 8 || mismatch}
        onClick={() => run(async () => { await create(pw); onCreated(); })}
      >
        {busy ? "Generating…" : "Create key"}
      </button>
      <p className="auth-fine">Minimum 8 characters. A lost passphrase cannot be recovered.</p>
    </div>
  );
}

function BackupScreen({ npub, onDone }: { npub: string | null; onDone: () => void }) {
  return (
    <div className="auth-form">
      <p className="auth-help">
        Your account is your <strong>public</strong> identity below. Your private key is stored encrypted in this
        browser. Back it up later from settings before relying on it elsewhere.
      </p>
      <label>Your npub (public — safe to share)</label>
      <input className="mono" readOnly value={npub ?? ""} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="auth-submit" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function ImportScreen({
  run,
  busy,
  importAccount,
  done,
}: {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  importAccount: ReturnType<typeof useNostrAuth>["importAccount"];
  done: () => void;
}) {
  const [key, setKey] = useState("");
  const [keyPw, setKeyPw] = useState("");
  const [savePw, setSavePw] = useState("");
  const isEncrypted = key.trim().startsWith("ncryptsec1");

  return (
    <div className="auth-form">
      <p className="auth-help auth-warn">
        Pasting a key here is less secure than an extension. Use a key you control for this dashboard — not your main
        social key.
      </p>
      <label>nsec / ncryptsec</label>
      <textarea className="mono" rows={2} value={key} autoFocus onChange={(e) => setKey(e.target.value)} />
      {isEncrypted && (
        <>
          <label>Decrypt passphrase (for the ncryptsec)</label>
          <input type="password" value={keyPw} onChange={(e) => setKeyPw(e.target.value)} />
        </>
      )}
      <label>Passphrase to store it under (this browser)</label>
      <input type="password" value={savePw} onChange={(e) => setSavePw(e.target.value)} />
      <button
        type="button"
        className="auth-submit"
        disabled={busy || key.trim().length === 0 || savePw.length < 8}
        onClick={() => run(async () => { await importAccount(key.trim(), isEncrypted ? keyPw : undefined, savePw); done(); })}
      >
        {busy ? "Importing…" : "Import key"}
      </button>
    </div>
  );
}

function UnlockScreen({
  run,
  busy,
  unlock,
  done,
}: {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  unlock: ReturnType<typeof useNostrAuth>["unlock"];
  done: () => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <div className="auth-form">
      <p className="auth-help">Enter your passphrase to unlock the key stored in this browser.</p>
      <label>Passphrase</label>
      <input
        type="password"
        value={pw}
        autoFocus
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && pw) run(async () => { await unlock(pw); done(); });
        }}
      />
      <button
        type="button"
        className="auth-submit"
        disabled={busy || pw.length === 0}
        onClick={() => run(async () => { await unlock(pw); done(); })}
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </div>
  );
}
