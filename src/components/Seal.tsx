// The cryptographic-attestation motif: a hexagonal "signed" seal. Every datum the
// UI shows cleared a Schnorr signature check (see src/nostr/verify.ts), so we mark
// verified things with this seal. It is the visual claim "this is real, not faked".

interface SealProps {
  /** px size of the square viewport. */
  size?: number;
  /** Add a slow shimmer sweep across the seal (used on the header crest). */
  animated?: boolean;
  title?: string;
}

/** Inline-SVG hex seal + check. Pure presentation, no deps. */
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
        {/* the guardian hexagon */}
        <path
          className="seal-ring"
          d="M12 1.6 21 6.8v10.4L12 22.4 3 17.2V6.8z"
          fill="none"
          strokeWidth="1.4"
        />
        {/* inner attestation glyph */}
        <path
          className="seal-check"
          d="M8 12.2l2.6 2.6L16.2 9"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {animated && <rect className="seal-sweep" x="-24" y="0" width="10" height="24" />}
      </svg>
    </span>
  );
}
