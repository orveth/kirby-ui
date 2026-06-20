// Tiny render-time formatting helpers shared across panels. Kept dependency-free
// and null-tolerant so the UI never prints "NaN" / "undefined" against empty or
// pending cluster state.

/** Group an integer with thin spaces: 12000 -> "12 000". Monospace-friendly. */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

/** Sats with a unit suffix; "—" when pending/unknown. */
export function sats(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${num(n)} sats`;
}

/** A coarse human duration from a seconds count: "8s" / "3m 20s" / "1h 02m". */
export function dur(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return "—";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "Ns ago" against the render clock; the heartbeat-age readout. */
export function ago(at: number, now: number): string {
  const d = now - at;
  if (!Number.isFinite(d)) return "—";
  if (d < 0) return "0s ago"; // clock skew guard
  return `${dur(d)} ago`;
}

/** A wall-clock HH:MM:SS from a unix-seconds timestamp (feed row times). */
export function clock(unixSecs: number): string {
  try {
    return new Date(unixSecs * 1000).toLocaleTimeString("en-GB", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

/** Bytes-per-second as a compact rate: "0 B/s" / "3.9 kB/s" / "1.2 MB/s". */
export function bps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)} B/s`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)} kB/s`;
  return `${(n / 1_000_000).toFixed(2)} MB/s`;
}
