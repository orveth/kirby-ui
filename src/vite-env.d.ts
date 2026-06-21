/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time default relay URL (set at deploy; falls back to localhost). */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
