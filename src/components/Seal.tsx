// The cryptographic-attestation motif: a STAR "signed" seal — on-theme for Dream
// Land while keeping its job. Every datum the UI shows cleared a Schnorr signature
// check (see src/nostr/verify.ts), so we mark verified things with this star seal.
// It is the visual claim "this is real, not faked" — a Warp Star of authenticity.

interface SealProps {
  /** px size of the square viewport. */
  size?: number;
  /** Add a slow twinkle/shimmer (used on the header crest). */
  animated?: boolean;
  title?: string;
}

/** A 5-point star path string centered in a 24x24 box. */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** Inline-SVG star seal + check. Pure presentation, no deps. */
export function Seal({ size = 16, animated = false, title = "signature verified" }: SealProps) {
  return (
    <span
      className={`seal${animated ? " seal--animated" : ""}`}
      title={title}
      role="img"
      aria-label={title}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        {/* the guardian star */}
        <polygon className="seal-ring" points={starPoints(12, 12.5, 10.6, 4.6)} strokeWidth="1.3" />
        {/* inner attestation check */}
        <path
          className="seal-check"
          d="M8.4 12.4l2.4 2.4L15.8 9.6"
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
