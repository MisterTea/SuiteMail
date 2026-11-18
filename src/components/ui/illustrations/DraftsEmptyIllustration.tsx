interface Props {
  size?: number;
  className?: string;
}

export function DraftsEmptyIllustration({ size = 140, className }: Props) {
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
        <radialGradient id="draftsHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.20" />
          <stop offset="60%" stopColor="var(--color-accent)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="draftPaper" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-bg-primary)" />
          <stop offset="100%" stopColor="var(--color-bg-secondary)" />
        </linearGradient>
        <linearGradient id="draftPen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="var(--color-accent)" />
        </linearGradient>
        <filter id="draftShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="var(--color-text-primary)" floodOpacity="0.10" />
        </filter>
      </defs>

      {/* Grounding shadow */}
      <ellipse cx="70" cy="112" rx="38" ry="6" fill="var(--color-border-primary)" opacity="0.35" />

      {/* Ambient background glow */}
      <circle cx="70" cy="65" r="46" fill="url(#draftsHalo)" />

      {/* Behind sheet (stacked paper effect) */}
      <rect
        x="36"
        y="30"
        width="60"
        height="74"
        rx="6"
        transform="rotate(-5 66 67)"
        fill="var(--color-bg-tertiary)"
        stroke="var(--color-border-secondary)"
        strokeWidth="1.2"
        opacity="0.6"
      />

      {/* Main drafting document */}
      <g filter="url(#draftShadow)">
        <path
          d="M44 26 C44 23.8 45.8 22 48 22 L82 22 L96 36 L96 98 C96 100.2 94.2 102 92 102 L48 102 C45.8 102 44 100.2 44 98 Z"
          fill="url(#draftPaper)"
          stroke="var(--color-border-primary)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Folded corner */}
        <path
          d="M82 22 L82 34 C82 35.1 82.9 36 84 36 L96 36 Z"
          fill="var(--color-bg-tertiary)"
          stroke="var(--color-border-primary)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>

      {/* Document header / subject line */}
      <rect x="52" y="36" width="24" height="3" rx="1.5" fill="var(--color-accent)" opacity="0.8" />

      {/* Content lines */}
      <rect x="52" y="47" width="36" height="2.5" rx="1.25" fill="var(--color-text-tertiary)" opacity="0.45" />
      <rect x="52" y="55" width="32" height="2.5" rx="1.25" fill="var(--color-text-tertiary)" opacity="0.45" />
      <rect x="52" y="63" width="26" height="2.5" rx="1.25" fill="var(--color-text-tertiary)" opacity="0.45" />
      <rect x="52" y="71" width="34" height="2.5" rx="1.25" fill="var(--color-text-tertiary)" opacity="0.45" />

      {/* Pen writing current draft line */}
      <path
        d="M52 79 Q60 80 68 79"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
        opacity="0.85"
      />

      {/* Stylus / Fountain Pen */}
      <g transform="translate(68, 65) rotate(35)">
        {/* Pen nib */}
        <path d="M0 16 L2.5 7 L-2.5 7 Z" fill="#e11d48" />
        <line x1="0" y1="16" x2="0" y2="10" stroke="#ffffff" strokeWidth="0.8" />
        {/* Nib collar */}
        <rect x="-3" y="4" width="6" height="3" rx="0.5" fill="var(--color-border-primary)" />
        {/* Pen barrel */}
        <rect x="-3.5" y="-18" width="7" height="22" rx="1.5" fill="url(#draftPen)" stroke="var(--color-border-secondary)" strokeWidth="0.8" />
        {/* Pen clip */}
        <rect x="-1" y="-16" width="2" height="12" rx="0.5" fill="#ffffff" opacity="0.75" />
      </g>

      {/* Subtle sparkle accents */}
      <circle cx="102" cy="48" r="1.5" fill="var(--color-accent)" opacity="0.6" />
      <circle cx="38" cy="74" r="1.2" fill="#f43f5e" opacity="0.5" />
      <circle cx="88" cy="88" r="1.2" fill="var(--color-accent)" opacity="0.4" />
    </svg>
  );
}
