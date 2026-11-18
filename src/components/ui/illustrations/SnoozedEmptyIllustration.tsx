interface Props {
  size?: number;
  className?: string;
}

export function SnoozedEmptyIllustration({ size = 140, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Soft background halo */}
      <circle
        cx="70"
        cy="70"
        r="54"
        fill="var(--color-accent)"
        opacity="0.08"
      />

      {/* Clock Outer Rim */}
      <circle
        cx="70"
        cy="65"
        r="38"
        fill="var(--color-bg-secondary)"
        stroke="var(--color-border-primary)"
        strokeWidth="1.5"
      />

      {/* Clock Inner Face */}
      <circle
        cx="70"
        cy="65"
        r="33"
        fill="var(--color-bg-tertiary)"
        stroke="var(--color-border-primary)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />

      {/* Hour ticks */}
      <line x1="70" y1="36" x2="70" y2="40" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="70" y1="90" x2="70" y2="94" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="41" y1="65" x2="45" y2="65" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="95" y1="65" x2="99" y2="65" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Center pin */}
      <circle cx="70" cy="65" r="3" fill="var(--color-accent)" />

      {/* Clock hands pointing to 9:00 */}
      <line
        x1="70"
        y1="65"
        x2="52"
        y2="65"
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="70"
        y1="65"
        x2="70"
        y2="46"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Crescent sleep moon near top right */}
      <path
        d="M102 34 C97 34 93 38 93 43 C93 49 97 53 103 53 C101 54 99 54 97 54 C91 54 86 49 86 43 C86 37 91 32 97 32 C99 32 101 32 102 34 Z"
        fill="var(--color-accent)"
        opacity="0.35"
      />

      {/* Floating Zzz */}
      <text
        x="98"
        y="30"
        fill="var(--color-accent)"
        fontSize="11"
        fontWeight="bold"
        opacity="0.8"
        fontFamily="sans-serif"
      >
        z
      </text>
      <text
        x="108"
        y="22"
        fill="var(--color-accent)"
        fontSize="13"
        fontWeight="bold"
        opacity="0.9"
        fontFamily="sans-serif"
      >
        Z
      </text>

      {/* Resting mail envelope badge at bottom */}
      <g transform="translate(46, 88)">
        <rect
          x="0"
          y="0"
          width="48"
          height="30"
          rx="5"
          fill="var(--color-bg-primary)"
          stroke="var(--color-border-primary)"
          strokeWidth="1.5"
        />
        <path
          d="M0 4 L24 19 L48 4"
          stroke="var(--color-border-primary)"
          strokeWidth="1.5"
          fill="none"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="19" r="6" fill="var(--color-accent)" opacity="0.15" />
        <circle cx="24" cy="19" r="2" fill="var(--color-accent)" />
      </g>

      {/* Sparkles */}
      <circle cx="28" cy="48" r="2.5" fill="var(--color-accent)" opacity="0.4" />
      <circle cx="36" cy="38" r="1.5" fill="var(--color-accent)" opacity="0.25" />
      <circle cx="114" cy="75" r="2" fill="var(--color-accent)" opacity="0.3" />
      <circle cx="106" cy="98" r="1.5" fill="var(--color-accent)" opacity="0.25" />
      <circle cx="26" cy="85" r="1.5" fill="var(--color-accent)" opacity="0.2" />
    </svg>
  );
}
