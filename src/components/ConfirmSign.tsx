// Confirm-before-sign. Any signature requested through useNostrAuth().signEvent()
// raises a pending request here; nothing is signed until the operator approves.
// A signed event in this app is a real command (it will spend sats / spawn compute),
// so the human always sees what they're authorizing first. Renders nothing when idle.

import { useNostrAuth } from "../nostr/useNostrAuth";

export function ConfirmSign() {
  const { pendingSign } = useNostrAuth();
  if (!pendingSign) return null;

  const { summary, template, approve, reject } = pendingSign;

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Confirm signature" onClick={reject}>
      <div className="auth-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <h2>Confirm</h2>
          <button type="button" className="auth-close" onClick={reject} aria-label="cancel">
            ✕
          </button>
        </div>

        <p className="auth-help">You&apos;re about to sign and publish:</p>
        <p className="confirm-summary">{summary}</p>

        <details className="confirm-raw">
          <summary>raw event</summary>
          <pre className="mono">{JSON.stringify(template, null, 2)}</pre>
        </details>

        <div className="confirm-actions">
          <button type="button" className="auth-link" onClick={reject}>
            Cancel
          </button>
          <button type="button" className="auth-submit" onClick={approve}>
            Sign &amp; publish
          </button>
        </div>
      </div>
    </div>
  );
}
