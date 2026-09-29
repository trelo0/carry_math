type IconProps = { className?: string };

export function IconChevronRight({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCalendar({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconClock({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5v3.2l2 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconPencil({ className }: IconProps) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="6.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 15c0-2.8 2.2-4.5 5-4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 15c0-2.2 1.8-3.5 4-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCourse({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 5.5L9 2.5l6 3v7L9 15.5 3 12.5V5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 9v6.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function IconFree({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" />
      <path d="M9 6v6M6 9h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconBreak({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 9h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="2 3" />
    </svg>
  );
}

export function IconBusy({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="4" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
