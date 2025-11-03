export interface LogoProps {
  className?: string;
  title?: string;
}

export function Logo({ className = "h-9 w-auto", title = "RobotCloud" }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 40"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="robotcloud-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="55%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path
        fill="url(#robotcloud-logo-gradient)"
        d="M22 32h20c6.627 0 12-5.373 12-12 0-5.351-3.546-9.884-8.543-11.422C43.812 4.416 38.342 0 32 0 25.218 0 19.527 4.935 18.44 11.323 13.188 12.507 9 17.055 9 22.667 9 28.557 13.612 32 22 32Z"
      />
      <rect x="24" y="14" width="16" height="14" rx="5" fill="#0f172a" opacity="0.92" />
      <path
        d="M32 6.75a2.75 2.75 0 0 0-2.75 2.75v2h5.5v-2A2.75 2.75 0 0 0 32 6.75Z"
        fill="#0f172a"
        opacity="0.72"
      />
      <circle cx="28.5" cy="21" r="2.2" fill="#f8fafc" />
      <circle cx="35.5" cy="21" r="2.2" fill="#f8fafc" />
      <circle cx="28.5" cy="21" r="1" fill="#0f172a" />
      <circle cx="35.5" cy="21" r="1" fill="#0f172a" />
      <rect x="29" y="25.5" width="6" height="1.5" rx="0.75" fill="#38bdf8" />
      <rect x="31.25" y="4.2" width="1.5" height="3.2" rx="0.75" fill="#38bdf8" />
      <circle cx="32" cy="3" r="1.4" fill="#38bdf8" />
    </svg>
  );
}
