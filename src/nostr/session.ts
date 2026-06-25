// Session persistence.
//
// What may be written at rest:
//  - local / imported: the NIP-49 `ncryptsec` + npub (the secret key is never
//    persisted in the clear; the user re-enters the passphrase to unlock).
//  - nip07: the npub only — the extension holds the key, we store no key material.
//
// Storage is passed in (Web Storage API shape) so this is pure and testable.

const SESSION_KEY = "kirby.session";

/** How the current session holds (or doesn't hold) its key. */
export type StoredSession =
  | { method: "nip07"; npub: string }
  | { method: "local"; npub: string; ncryptsec: string }
  | { method: "imported"; npub: string; ncryptsec: string };

/** Persist the session. Only the fields above are written — never a raw key. */
export function saveSession(storage: Storage, session: StoredSession): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Load the stored session, or null if absent or corrupt (never throws). */
export function loadSession(storage: Storage): StoredSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Forget the stored session (logout). */
export function clearSession(storage: Storage): void {
  storage.removeItem(SESSION_KEY);
}
