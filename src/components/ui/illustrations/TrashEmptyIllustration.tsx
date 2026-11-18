interface Props {
  size?: number;
  className?: string;
}

export function TrashEmptyIllustration({ size = 140, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="trashHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#ef4444" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="trashCanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="60%" stopColor="#e11d48" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
        <linearGradient id="trashBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <filter id="trashGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#f43f5e" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* Grounding shadow */}
      <ellipse cx="70" cy="116" rx="38" ry="6" fill="var(--color-border-primary)" opacity="0.35" />
      <line x1="32" y1="116" x2="108" y2="116" stroke="var(--color-border-secondary)" strokeWidth="1" strokeLinecap="round" />

      {/* Ambient glowing halo */}
      <circle cx="70" cy="72" r="48" fill="url(#trashHalo)" />
      <circle
        cx="70"
        cy="72"
        r="42"
        stroke="#f43f5e"
        strokeWidth="1"
        strokeDasharray="3 4"
        opacity="0.2"
      />

      {/* Floating sparkles / sparkles indicating cleanliness */}
      <path
        d="M102 40 Q102 45 107 45 Q102 45 102 50 Q102 45 97 45 Q102 45 102 40 Z"
        fill="#f43f5e"
        opacity="0.7"
      />
      <path
        d="M38 52 Q38 56 42 56 Q38 56 38 60 Q38 56 34 56 Q38 56 38 52 Z"
        fill="#f43f5e"
        opacity="0.5"
      />
      <circle cx="98" cy="88" r="2" fill="#f43f5e" opacity="0.4" />
      <circle cx="42" cy="80" r="1.5" fill="#f43f5e" opacity="0.4" />

      {/* Trash Can Lid (angled open slightly for visual interest) */}
      <g filter="url(#trashGlow)">
        {/* Lid Handle */}
        <rect x="65" y="44" width="10" height="4" rx="2" fill="#e11d48" />
        {/* Lid Plate */}
        <path
          d="M48 51 C48 49.5 50 49 52 49 L88 49 C90 49 92 49.5 92 51 L94 54 C94 55 93 55.5 91 55.5 L49 55.5 C47 55.5 46 55 46 54 Z"
          fill="url(#trashCanGrad)"
        />
      </g>

      {/* Trash Can Body */}
      <path
        d="M51 58 L56 106 C56.5 108.5 58.5 110 61 110 L79 110 C81.5 110 83.5 108.5 84 106 L89 58 Z"
        fill="var(--color-bg-tertiary)"
        stroke="var(--color-border-primary)"
        strokeWidth="1.5"
      />

      {/* Fluted Vertical Ribs on Can Body */}
      <line x1="63" y1="64" x2="65" y2="102" stroke="var(--color-border-secondary)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="70" y1="64" x2="70" y2="102" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="77" y1="64" x2="75" y2="102" stroke="var(--color-border-secondary)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Clean leaf / check emblem indicating empty / clean */}
      <circle cx="70" cy="80" r="7" fill="#f43f5e" opacity="0.12" />
      <path
        d="M66.5 80 L69 82.5 L73.5 77.5"
        stroke="#e11d48"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
