// UI-side tuning constants. These are render-time thresholds the data-layer
// selectors take as arguments (the data layer is policy-free on purpose); the UI
// owns the "what counts as stale/idle" call.

/** A node with no presence beacon for this many seconds reads as DEAD/STALE. */
export const STALE_WINDOW_SECS = 20;

/** A meter with no tick for this many seconds reads as "no signal" (idle). */
export const METER_IDLE_SECS = 6;

/** cpu_pct is percent-of-one-core; the gauge sweeps 0..this. */
export const CPU_MAX_PCT = 100;
