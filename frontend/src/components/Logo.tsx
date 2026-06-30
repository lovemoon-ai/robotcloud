export interface LogoProps {
  className?: string;
  title?: string;
}

export function Logo({ className = "h-9 w-auto", title = "RobotCloud" }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Cloud behind robot */}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M44 52h12c4.4 0 8-3.6 8-8 0-3.6-2.4-6.6-5.7-7.6.1-.5.1-1 .1-1.4 0-5.5-4.5-10-10-10-1.4 0-2.7.3-3.9.8"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M52 44c2.2 0 4-1.8 4-4s-1.8-4-4-4"
      />

      {/* Robot antenna */}
      <line
        x1="24"
        y1="12"
        x2="24"
        y2="6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle
        cx="24"
        cy="4"
        r="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />

      {/* Robot head */}
      <rect
        x="10"
        y="12"
        width="28"
        height="22"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />

      {/* Robot eyes */}
      <circle cx="18" cy="22" r="3" fill="currentColor" />
      <circle cx="30" cy="22" r="3" fill="currentColor" />

      {/* Robot mouth */}
      <line
        x1="18"
        y1="28"
        x2="30"
        y2="28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Robot ears */}
      <rect
        x="4"
        y="18"
        width="4"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="40"
        y="18"
        width="4"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />

      {/* Robot body */}
      <rect
        x="14"
        y="36"
        width="20"
        height="16"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />

      {/* Robot body details */}
      <circle cx="24" cy="42" r="2" fill="currentColor" />
      <line
        x1="20"
        y1="47"
        x2="28"
        y2="47"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Robot arms */}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 40 L8 44 L8 50"
      />
      <circle cx="8" cy="52" r="2" fill="currentColor" />

      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M34 40 L40 44 L40 50"
      />
      <circle cx="40" cy="52" r="2" fill="currentColor" />

      {/* Robot legs */}
      <line
        x1="20"
        y1="52"
        x2="20"
        y2="58"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="28"
        y1="52"
        x2="28"
        y2="58"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Robot feet */}
      <ellipse cx="20" cy="60" rx="3" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="28" cy="60" rx="3" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
