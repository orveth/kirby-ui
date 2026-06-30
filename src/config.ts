// UI-side tuning constants. These are render-time thresholds the data-layer
// selectors take as arguments (the data layer is policy-free on purpose); the UI
// owns the "what counts as stale/idle" call.

/** A node with no presence beacon for this many seconds reads as DEAD/STALE. */
export const STALE_WINDOW_SECS = 20;

/** A node silent for LONGER than this is treated as GONE (decommissioned) and dropped
 *  from the grid entirely — distinct from DEAD/STALE (STALE_WINDOW_SECS), which keeps
 *  showing the cell so a brief outage stays visible. Kept far above the stale window so a
 *  daemon restart/redeploy (seconds–minutes) never makes a node vanish, but a node taken
 *  down for good clears itself instead of lingering forever (the relay retains the last
 *  10100 beacon indefinitely). FLAG for gudnuf: 600s (10 min) proposed — tune to taste. */
export const NODE_GONE_SECS = 600;

/** A meter with no tick for this many seconds reads as "no signal" (idle). */
export const METER_IDLE_SECS = 6;

/** cpu_pct is percent-of-one-core; the gauge sweeps 0..this. */
export const CPU_MAX_PCT = 100;
