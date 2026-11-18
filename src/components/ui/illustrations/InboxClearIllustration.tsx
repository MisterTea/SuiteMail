interface Props {
  size?: number;
  className?: string;
}

export function InboxClearIllustration({ size = 150, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Ambient radial glow behind the entire composition */}
        <radialGradient id="inboxZeroAmbient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.3" />
          <stop offset="60%" stopColor="var(--color-accent)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>

        {/* Badge gradient */}
        <linearGradient id="inboxZeroBadge" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-hover, var(--color-accent))" />
        </linearGradient>

        {/* Tray surface gradient */}
        <linearGradient id="traySurface" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--color-bg-secondary)" />
          <stop offset="100%" stopColor="var(--color-bg-tertiary)" />
        </linearGradient>

        {/* Tray inner depth gradient */}
        <linearGradient id="trayInner" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--color-bg-tertiary)" />
          <stop offset="100%" stopColor="var(--color-bg-secondary)" />
        </linearGradient>

        {/* Sparkle gradient */}
        <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Ambient background aura */}
      <circle cx="80" cy="80" r="70" fill="url(#inboxZeroAmbient)" />

      {/* Ground soft shadow */}
      <ellipse
        cx="80"
        cy="128"
        rx="50"
        ry="8"
        fill="var(--color-text-primary)"
        opacity="0.07"
      />

      {/* Tray back lid (open) */}
      <path
        d="M32 74 L80 46 L128 74"
        stroke="var(--color-border-primary)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="url(#traySurface)"
        opacity="0.85"
      />

      {/* Tray main container body */}
      <rect
        x="28"
        y="68"
        width="104"
        height="54"
        rx="10"
        fill="url(#traySurface)"
        stroke="var(--color-border-primary)"
        strokeWidth="1.75"
      />

      {/* Tray interior recess shadow */}
      <rect
        x="36"
        y="76"
        width="88"
        height="38"
        rx="6"
        fill="url(#trayInner)"
        stroke="var(--color-border-secondary)"
        strokeWidth="1"
      />

      {/* Front cutout accent notch */}
      <path
        d="M62 68 C62 74 66 78 72 78 L88 78 C94 78 98 74 98 68"
        fill="url(#trayInner)"
        stroke="var(--color-border-primary)"
        strokeWidth="1.75"
      />

      {/* Celebratory Checkmark Emblem (Floating Hero) */}
      <g transform="translate(0, -6)">
        {/* Glow halo behind check badge */}
        <circle
          cx="80"
          cy="86"
          r="26"
          fill="var(--color-accent)"
          opacity="0.18"
        />
        <circle
          cx="80"
          cy="86"
          r="20"
          fill="var(--color-accent)"
          opacity="0.25"
        />

        {/* Badge circle */}
        <circle
          cx="80"
          cy="86"
          r="16"
          fill="url(#inboxZeroBadge)"
          stroke="white"
          strokeWidth="1.5"
          strokeOpacity="0.4"
        />

        {/* Checkmark */}
        <path
          d="M72 86 L77.5 91.5 L88.5 80.5"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Celebratory 4-point Sparkle Stars */}
      {/* Top right sparkle */}
      <path
        d="M124 38 Q124 46 132 46 Q124 46 124 54 Q124 46 116 46 Q124 46 124 38 Z"
        fill="url(#sparkleGrad)"
        opacity="0.9"
      />
      <circle cx="136" cy="58" r="2" fill="var(--color-accent)" opacity="0.6" />

      {/* Top left sparkle */}
      <path
        d="M38 32 Q38 38 44 38 Q38 38 38 44 Q38 38 32 38 Q38 38 38 32 Z"
        fill="url(#sparkleGrad)"
        opacity="0.8"
      />
      <circle cx="26" cy="48" r="2" fill="var(--color-accent)" opacity="0.5" />

      {/* Mid right confetti dot */}
      <circle cx="138" cy="82" r="2.5" fill="var(--color-accent)" opacity="0.45" />

      {/* Mid left confetti star */}
      <path
        d="M22 84 Q22 88 26 88 Q22 88 22 92 Q22 88 18 88 Q22 88 22 84 Z"
        fill="var(--color-accent)"
        opacity="0.5"
      />

      {/* Bottom celebration dot */}
      <circle cx="118" cy="112" r="1.75" fill="var(--color-accent)" opacity="0.4" />
      <circle cx="42" cy="116" r="1.5" fill="var(--color-accent)" opacity="0.35" />
    </svg>
  );
}

export const InboxZeroIllustration = InboxClearIllustration;
