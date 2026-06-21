// The hero element: an inline-SVG Kirby mascot (pink puffball) whose EXPRESSION is
// driven by `kirbyMood`, a pure function of the agent's real signed state. Body,
// eyes, cheek blushes and little red feet are constant; the mood only swaps the
// eyes/mouth/brows + decoration (a KO star, spawn sparkles, hunger sweat, zzz).
//
// Pure presentation, zero deps. Everything animates via CSS classes in index.css,
// so reduced-motion users get a static (still legible) face.

import type { KirbyMood } from "./kirbyMood";

interface KirbyProps {
  mood: KirbyMood;
  /** px size of the square mascot. */
  size?: number;
  /** Pass true when the agent's meter shows live activity -> a subtle "inhale". */
  active?: boolean;
}

/** Human-readable label for screen readers / titles, per mood. */
const MOOD_LABEL: Record<KirbyMood, string> = {
  ko: "Kirby is down — reaped",
  dizzy: "Kirby is halting — dizzy",
  hungry: "Kirby is hungry — runway running low",
  happy: "Kirby is happy — well fed",
  spawn: "Kirby just spawned",
  sleepy: "Kirby is resting — no state yet",
};

export function Kirby({ mood, size = 132, active = false }: KirbyProps) {
  const label = MOOD_LABEL[mood];
  return (
    <span
      className={`kirby kirby--${mood}${active ? " kirby--active" : ""}`}
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <defs>
          {/* soft pink body shading — bright top-left, deeper bottom-right */}
          <radialGradient id="kirbyBody" cx="38%" cy="32%" r="78%">
            <stop offset="0%" stopColor="#ffd9e4" />
            <stop offset="46%" stopColor="#ffb7c5" />
            <stop offset="100%" stopColor="#ff8fb0" />
          </radialGradient>
          <radialGradient id="kirbyShine" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* the floating body group (CSS bobs the whole puffball) */}
        <g className="kirby-body">
          {/* feet — little red ovals, behind the body */}
          <g className="kirby-feet">
            <ellipse className="kirby-foot kirby-foot--l" cx="40" cy="104" rx="15" ry="9" />
            <ellipse className="kirby-foot kirby-foot--r" cx="82" cy="103" rx="16" ry="9" />
          </g>

          {/* the round body */}
          <circle className="kirby-ball" cx="60" cy="58" r="46" fill="url(#kirbyBody)" />
          {/* arm nubs */}
          <ellipse className="kirby-arm kirby-arm--l" cx="17" cy="64" rx="9" ry="12" fill="url(#kirbyBody)" />
          <ellipse className="kirby-arm kirby-arm--r" cx="103" cy="64" rx="9" ry="12" fill="url(#kirbyBody)" />
          {/* top-left sheen */}
          <ellipse cx="44" cy="36" rx="20" ry="14" fill="url(#kirbyShine)" />

          {/* cheek blushes — always rosy */}
          <ellipse className="kirby-cheek" cx="36" cy="64" rx="9" ry="5.5" />
          <ellipse className="kirby-cheek" cx="84" cy="64" rx="9" ry="5.5" />

          {/* ---- the face: mood-specific eyes + mouth + brows ---- */}
          <Face mood={mood} />
        </g>

        {/* decorations that live OUTSIDE the bobbing body */}
        {mood === "ko" && <KoStar />}
        {mood === "spawn" && <Sparkles />}
        {mood === "sleepy" && <Zzz />}
        {mood === "hungry" && <Sweat />}
      </svg>
    </span>
  );
}

/** The expression. Eyes are the classic tall blue-black ovals with a white glint;
 *  each mood overrides eyes/mouth and adds brows where it helps read the emotion. */
function Face({ mood }: { mood: KirbyMood }) {
  const EYE_Y = 48;
  const EYE_DX = 14; // half the eye spacing
  const cxL = 60 - EYE_DX;
  const cxR = 60 + EYE_DX;

  if (mood === "ko") {
    // X eyes + a flat, deflated little mouth.
    return (
      <g className="kirby-face">
        <XEye cx={cxL} cy={EYE_Y} />
        <XEye cx={cxR} cy={EYE_Y} />
        <path className="kirby-mouth-stroke" d="M52 70 Q60 66 68 70" fill="none" />
      </g>
    );
  }

  if (mood === "dizzy") {
    // spiral eyes + a wavy woozy mouth.
    return (
      <g className="kirby-face">
        <SpiralEye cx={cxL} cy={EYE_Y} />
        <SpiralEye cx={cxR} cy={EYE_Y} />
        <path className="kirby-mouth-stroke" d="M51 70 q4 -5 8 0 t8 0" fill="none" />
      </g>
    );
  }

  if (mood === "hungry") {
    // worried slanted brows, eyes, and a big open (hungry) mouth.
    return (
      <g className="kirby-face">
        <path className="kirby-brow" d="M40 38 L52 42" />
        <path className="kirby-brow" d="M80 38 L68 42" />
        <Eye cx={cxL} cy={EYE_Y + 2} />
        <Eye cx={cxR} cy={EYE_Y + 2} />
        {/* open mouth, tongue inside */}
        <ellipse className="kirby-mouth-open" cx="60" cy="72" rx="9" ry="8" />
        <path className="kirby-tongue" d="M53 74 a7 5 0 0 0 14 0 z" />
      </g>
    );
  }

  if (mood === "spawn") {
    // bright happy eyes (extra glint) + a wide excited smile.
    return (
      <g className="kirby-face">
        <Eye cx={cxL} cy={EYE_Y} sparkle />
        <Eye cx={cxR} cy={EYE_Y} sparkle />
        <path className="kirby-mouth-fill" d="M49 66 q11 16 22 0 q-11 7 -22 0 z" />
      </g>
    );
  }

  if (mood === "sleepy") {
    // closed, gently-curved eyes + a tiny calm mouth.
    return (
      <g className="kirby-face">
        <path className="kirby-eye-closed" d="M42 50 q4 4 8 0" fill="none" />
        <path className="kirby-eye-closed" d="M70 50 q4 4 8 0" fill="none" />
        <path className="kirby-mouth-stroke" d="M55 68 q5 4 10 0" fill="none" />
      </g>
    );
  }

  // happy (default running, well-fed): content eyes + a soft smile.
  return (
    <g className="kirby-face">
      <Eye cx={cxL} cy={EYE_Y} />
      <Eye cx={cxR} cy={EYE_Y} />
      {/* the iconic open smile */}
      <path className="kirby-mouth-fill kirby-mouth-smile" d="M50 65 q10 14 20 0 q-10 6 -20 0 z" />
    </g>
  );
}

/** The classic tall oval eye: dark blue body, white upper glint. */
function Eye({ cx, cy, sparkle }: { cx: number; cy: number; sparkle?: boolean }) {
  return (
    <g className="kirby-eye">
      <ellipse className="kirby-eye-ball" cx={cx} cy={cy} rx="5.2" ry="9" />
      <ellipse className="kirby-eye-glint" cx={cx} cy={cy - 4} rx="2.4" ry="3.4" />
      {sparkle && <ellipse className="kirby-eye-glint2" cx={cx + 1.5} cy={cy + 3} rx="1.1" ry="1.6" />}
    </g>
  );
}

function XEye({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="kirby-xeye">
      <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
      <line x1={cx + 5} y1={cy - 5} x2={cx - 5} y2={cy + 5} />
    </g>
  );
}

function SpiralEye({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="kirby-spiral" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <path
        d={`M${cx} ${cy} m0 0 a2 2 0 1 1 -0.1 0 a4 4 0 1 0 4 4`}
        fill="none"
        transform={`translate(${-2}, ${-2})`}
      />
    </g>
  );
}

/** A little yellow star spinning above a KO'd Kirby. */
function KoStar() {
  return (
    <g className="kirby-kostar">
      <Star cx={60} cy={10} r={7} />
    </g>
  );
}

/** Excited sparkles around a freshly-spawned Kirby. */
function Sparkles() {
  return (
    <g className="kirby-sparkles">
      <Star cx={16} cy={20} r={4} />
      <Star cx={104} cy={16} r={5} />
      <Star cx={100} cy={86} r={3.5} />
      <Star cx={20} cy={84} r={3} />
    </g>
  );
}

/** "z z z" drifting up from a resting Kirby. */
function Zzz() {
  return (
    <g className="kirby-zzz">
      <text x="92" y="40" className="kirby-z kirby-z1">z</text>
      <text x="100" y="28" className="kirby-z kirby-z2">z</text>
      <text x="108" y="18" className="kirby-z kirby-z3">z</text>
    </g>
  );
}

/** A worried sweat-drop by a hungry Kirby's brow. */
function Sweat() {
  return (
    <g className="kirby-sweat">
      <path d="M96 36 q5 7 0 11 a5.5 5.5 0 0 1 0 -11 z" />
    </g>
  );
}

/** A 5-point star path centered at (cx,cy). Reused for seals, nodes, decorations. */
export function Star({ cx, cy, r, className }: { cx: number; cy: number; r: number; className?: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.44;
    pts.push(`${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`);
  }
  return <polygon className={className ? `kirby-star ${className}` : "kirby-star"} points={pts.join(" ")} />;
}
