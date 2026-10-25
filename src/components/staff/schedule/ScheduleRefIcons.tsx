import type { ReactNode } from 'react';

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconCalendarRef = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const IconClockRef = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconBellRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
);
export const IconUserRef = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Svg>
);
export const IconUsersRef = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3 19c.6-3 2.8-4.6 6-4.6s5.4 1.6 6 4.6" />
    <path d="M16 6.3a3 3 0 0 1 0 5.4M18 14.6c1.8.6 2.7 2 3 4.4" />
  </Svg>
);
export const IconVideoRef = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="m15.5 11 5-3v8l-5-3" />
  </Svg>
);
export const IconPalmRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21V11" />
    <path d="M12 11c-1-3.5-4-5-7-4.5 1.5-2 4.5-2.5 7 .5 2.5-3 5.5-2.5 7-.5-3-.5-6 1-7 4.5Z" />
    <path d="M5 21h14" />
  </Svg>
);
export const IconPencilRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m13.5 8 3 3" />
  </Svg>
);
export const IconSwapRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8h13l-3-3M19 16H6l3 3" />
  </Svg>
);
export const IconCheckRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconXRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconUserPlusRef = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="8.5" r="3.5" />
    <path d="M3.5 20c.7-3.4 3.3-5.3 6.5-5.3M18 13v6M15 16h6" />
  </Svg>
);
export const IconPlusRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconChevronLeftRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);
export const IconChevronDownRef = (p: IconProps) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const IconChevronRightRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);
export const IconNoteRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V3.5Z" />
    <path d="M14.5 3.5V8H19M9 12.5h6M9 16h6" />
  </Svg>
);
export const IconChartRef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 20V10M12 20V4M19 20v-7" />
  </Svg>
);
export const IconPanelRef = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M14.5 5v14" />
  </Svg>
);
