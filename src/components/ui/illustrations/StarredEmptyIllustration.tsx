interface Props {
  size?: number;
  className?: string;
}

export function StarredEmptyIllustration({ size = 140, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <radialGradient id="starHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-warning)" stopOpacity="0.25" />
          <stop offset="60%" stopColor="var(--color-warning)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--color-warning)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="starGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="40%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <filter id="starGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#f59e0b" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Grounding shadow */}
      <ellipse cx="70" cy="106" rx="36" ry="5" fill="var(--color-border-primary)" opacity="0.3" />
      <line x1="34" y1="106" x2="106" y2="106" stroke="var(--color-border-secondary)" strokeWidth="1" strokeLinecap="round" />

      {/* Ambient glowing halos */}
      <circle cx="70" cy="62" r="44" fill="url(#starHalo)" />
      <circle
        cx="70"
        cy="62"
        r="38"
        stroke="var(--color-warning)"
        strokeWidth="1"
        strokeDasharray="3 4"
        opacity="0.25"
      />

      {/* Main central 5-point star */}
      <path
        d="M70 38 L75.6 52.3 L90.9 53.2 L79.1 62.9 L82.9 77.8 L70 69.5 L57.1 77.8 L60.9 62.9 L49.1 53.2 L64.4 52.3 Z"
        fill="url(#starGold)"
        stroke="#d97706"
        strokeWidth="1.5"
        strokeLinejoin="round"
        filter="url(#starGlow)"
      />

      {/* Inner facet highlight on star */}
      <path
        d="M70 38 L70 69.5 L82.9 77.8 L79.1 62.9 L90.9 53.2 L75.6 52.3 Z"
        fill="#ffffff"
        opacity="0.18"
      />

      {/* Four-pointed sparkle: top right */}
      <path
        d="M104 34 Q104 40 110 40 Q104 40 104 46 Q104 40 98 40 Q104 40 104 34 Z"
        fill="var(--color-warning)"
        opacity="0.75"
      />

      {/* Four-pointed sparkle: top left */}
      <path
        d="M36 44 Q36 49 41 49 Q36 49 36 54 Q36 49 31 49 Q36 49 36 44 Z"
        fill="var(--color-warning)"
        opacity="0.6"
      />

      {/* Four-pointed sparkle: lower right */}
      <path
        d="M102 78 Q102 81 105 81 Q102 81 102 84 Q102 81 99 81 Q102 81 102 78 Z"
        fill="var(--color-warning)"
        opacity="0.5"
      />

      {/* Soft floating stars / particles */}
      <circle cx="38" cy="74" r="2" fill="var(--color-warning)" opacity="0.4" />
      <circle cx="70" cy="22" r="2.5" fill="var(--color-warning)" opacity="0.5" />
      <circle cx="88" cy="26" r="1.5" fill="var(--color-warning)" opacity="0.3" />
      <circle cx="52" cy="28" r="1.5" fill="var(--color-warning)" opacity="0.3" />
    </svg>
  );
}
