'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type {
  CabinetCourseProgress,
  CabinetCourseViewSlice,
  CabinetData,
  CabinetCourseCatalog,
  CabinetCourseModulePreview,
  CabinetCourseStop,
  CourseCabinetState,
} from '@/lib/cabinet';
import CourseCabinetGate from '@/components/cabinet/CourseCabinetGate';
import {
  buildModulesFromCatalogPreviews,
  buildStopsFromCatalogPreviews,
  getCourseCabinetState,
  hasCourseCatalogOffer,
  lessonPathForStop,
  mapContentToCourseModules,
  mapContentToStructureStops,
  shouldShowCourseCabinetGate,
} from '@/lib/cabinet';
import { DEFAULT_LESSON_CONTENT_CHIPS } from '@/lib/studio/courseContent';
import { buildAchievementViews } from '@/lib/cabinet-achievements';
import LessonPlayer from '@/components/cabinet/LessonPlayer';
import {
  buildRoadmapGeometry,
  buildRoadSegments,
  moduleColorAt,
  rmStopTone,
  type RoadmapGeometry,
  type RoadTone,
} from '@/components/cabinet/courseRoadmap';

/* -------------------------------------------------------------------------- */
/* Типы карты курса (данные из Supabase + Sanity).                             */
/* -------------------------------------------------------------------------- */

type StopStatus = 'watched' | 'done' | 'now' | 'locked';
type StopKind = 'webinar' | 'practice' | 'milestone';
type CourseStop = {
  id: number;
  sanityLessonId: string | null;
  lessonId: number | null;
  module: number;
  numInModule: number;
  status: StopStatus;
  kind: StopKind;
  title: string;
  date: string;
  liveUrl: string | null;
  recordingUrl: string | null;
  description: string | null;
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
};

const SANITY_PLACEHOLDER = 'ВВЕДИТЕ ТЕКСТ';

function sanityText(value: string | null | undefined, fallback = '—'): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toUpperCase() === SANITY_PLACEHOLDER) return fallback;
  return trimmed;
}

function sanityList(value: string | null | undefined): string[] {
  const items =
    value
      ?.split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s && s.toUpperCase() !== SANITY_PLACEHOLDER) ?? [];
  return items.length ? items : [];
}

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

/* Настройки профиля: допустимые значения для выпадающих списков. */
const GRADES = ['5', '6', '7', '8', '9', '10', '11'];
const STUDY_GOALS = [
  'Повысить успеваемость',
  'Подтянуть школьную программу',
  'Подготовка к ЦТ',
  'Подготовка к экзаменам',
  'Подготовка к олимпиадам',
  'Поступление в вуз',
  'Другое',
];

function packagesHref(): string {
  return '/cabinet?section=payments';
}

function checkoutHref(courseSlug?: string): string {
  if (courseSlug) return `/cabinet/checkout?product=course&course=${encodeURIComponent(courseSlug)}`;
  return '/cabinet/checkout?product=course';
}

function applyCourseProgress(stops: CourseStop[], progress: CabinetCourseProgress[]): CourseStop[] {
  if (progress.length === 0) return stops;
  const map = new Map(progress.map((p) => [p.lessonIndex, p.status]));
  return stops.map((s) => ({ ...s, status: map.get(s.id - 1) ?? 'locked' }));
}

type SectionId = 'course' | 'payments' | 'settings';

const NAV_GROUPS = [
  {
    label: 'Обучение',
    items: [
      { id: 'course' as const, label: 'Курс', icon: 'course' },
      { id: 'payments' as const, label: 'Оплаты', icon: 'payments' },
    ],
  },
  {
    label: 'Аккаунт',
    items: [{ id: 'settings' as const, label: 'Настройки', icon: 'settings' }],
  },
] as const;

/* -------------------------------------------------------------------------- */

const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  course: 'M5 3h14v18l-7-4-7 4V3z',
  individual: 'M8 4V2h2 M14 2v2 M5 8h14 M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M12 11v6 M9 14h6',
  homework: 'M6 2h9l5 5v15H6V2z M14 2v6h6 M9 13h6 M9 17h6',
  results: 'M3 20h18 M6 16l4-5 3 3 5-7',
  payments: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M12 22.08V12 M3.27 6.96 12 12.01l8.73-5.05',
  schedule: 'M8 4V2h2 M14 2v2 M5 8h14 M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M15 13.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M15 13.2v1.2l.85.85',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6 M10 19a2 2 0 0 0 4 0',
  support: 'M4 12a8 8 0 0 1 16 0 M4 12v4a2 2 0 0 0 2 2h2v-6H4 M20 12v4a2 2 0 0 1-2 2h-2v-6h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  send: 'M22 2 11 13 M22 2 15 22l-4-9-9-4 20-7z',
  check: 'M4 12.5 9.5 18 20 6.5',
  x: 'M6 6l12 12 M18 6 6 18',
  lock: 'M6 11h12v10H6V11z M9 11V8a3 3 0 0 1 6 0v3',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0V4z M8 5H4.5a3 3 0 0 0 3.5 4 M16 5h3.5a3 3 0 0 1-3.5 4 M12 14v4 M8 21h8 M10 18h4',
  play: 'M9 6.5v11l9-5.5-9-5.5z',
  file: 'M6 2h9l5 5v15H6V2z M14 2v6h6',
  download: 'M12 3v11 M7 10l5 5 5-5 M4 20h16',
  chevron: 'm9 5 7 7-7 7',
  chevronLeft: 'm15 5-7 7 7 7',
  star: 'M12 3.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 7.2 18.1l.9-5.4L4.2 8.9l5.4-.8L12 3.2z',
  back: 'M19 12H5 M11 18l-6-6 6-6',
  users: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 19a5 5 0 0 1 10 0 M17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 19a5 5 0 0 1 10 0',
  edit: 'M4 20h4L20 8l-4-4L4 16v4z M13 6l4 4',
  clock: 'M12 7v5l3 3 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  burger: 'M4 7h16 M4 12h16 M4 17h16',
  plus: 'M12 5v14 M5 12h14',
  rocket: 'M12 2c3 2 5 6 5 10l3 4-4-1a8 8 0 0 1-8 0l-4 1 3-4c0-4 2-8 5-10z M12 9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z M9 19l-1.5 3 M15 19l1.5 3',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  expand: 'M8 3H3v5 M16 3h5v5 M8 21H3v-5 M16 21h5v-5',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v5l3.5 2 M12 2v2 M12 20v2 M2 12h2 M20 12h2',
  shield: 'M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z M9 12l2 2 4-4',
  spark: 'M12 2.5 14.8 9.2 21.5 12 14.8 14.8 12 21.5 9.2 14.8 2.5 12 9.2 9.2 Z',
  brain:
    'M9.5 5.2C8 5.5 7 6.8 7 8.4c-1.4.3-2.5 1.5-2.5 3.1 0 1.2.6 2.2 1.5 2.8-.2.5-.3 1.1-.3 1.7 0 2.2 1.7 3.5 3.8 3.5h4.9c2.1 0 3.8-1.3 3.8-3.5 0-.6-.1-1.2-.3-1.7.9-.6 1.5-1.6 1.5-2.8 0-1.6-1.1-2.8-2.5-3.1 0-1.6-1-2.9-2.5-3.2-.7-.8-1.8-1.3-3-1.3-1.1 0-2.1.4-2.9 1.1z M9.2 10.5v4.2 M14.8 10.5v4.2 M12 9.2v6.2',
  feather: 'M20 4.5C14 10 10 14 6.5 20L4 21l1-2.5C10.5 14 14 10 20 4.5z',
  screen: 'M3 4h18v11H3V4z M12 15v4 M8 21h8 M7 8h7 M7 11h5',
  flask: 'M9 3h6 M10 3v6.5L5.6 17A2 2 0 0 0 7.4 20h9.2a2 2 0 0 0 1.8-3L14 9.5V3 M7.8 14h8.4',
  cart: 'M6 6h15l-1.5 9h-12L6 6z M6 6l-2-2 M9 10v4 M15 10v4',
  info: 'M12 8v4 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  exit: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  phone: 'M7 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 5 5.2 2 2 0 0 1 7 3z',
  cap: 'M2 8.5 12 4l10 4.5-10 4.5L2 8.5z M6 10.6V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.4 M21 9.5V15',
};

function Icon({ d, className, strokeWidth = 1.7 }: { d: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function CabSetSelect({
  icon,
  value,
  options,
  onChange,
}: {
  icon: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`cab-set-input cab-set-input--select${open ? ' is-open' : ''}`} ref={rootRef}>
      <Icon d={icon} />
      <button
        type="button"
        className="cab-set-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        {value}
      </button>
      <Icon d={ICONS.chevron} className="cab-set-select-chev" />
      {open && (
        <ul className="cab-set-select-menu" role="listbox">
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                className={option === value ? 'is-active' : undefined}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`cab-heart${filled ? ' is-full' : ''}`} aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor" />
    </svg>
  );
}

const SUPPORT_EMAIL = 'district.school.210@gmail.com';

/* Ссылка на ТГ-бота: открывает чат с ботом и стартовым сообщением. */
function tgBotUrl(start: string): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return username ? `https://t.me/${username}?start=${start}` : `mailto:${SUPPORT_EMAIL}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysInSystem(createdAt: string): number {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function initials(name: string): string {
  /* локаль зафиксирована, чтобы SSR и браузер дали одинаковый результат */
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toLocaleUpperCase('ru-RU'))
    .join('');
}

/* ---------------------------- Путь курса (динамическая геометрия по модулям) ---------- */

const ROAD_TONE_STYLE: Record<RoadTone, { glow: string; ribbon: string; rim: string; core: string; mark: string; pad: string; station: string }> = {
  passed: {
    glow: 'rgba(0, 168, 255, 0.16)',
    ribbon: 'rgba(0, 175, 235, 0.52)',
    rim: 'rgba(130, 220, 255, 0.65)',
    core: 'rgba(200, 240, 255, 0.88)',
    mark: 'rgba(255, 255, 255, 0.72)',
    pad: 'rgba(0, 168, 255, 0.22)',
    station: 'rgba(0, 190, 255, 0.85)',
  },
  active: {
    glow: 'rgba(0, 168, 255, 0.22)',
    ribbon: 'rgba(0, 180, 245, 0.58)',
    rim: 'rgba(255, 168, 60, 0.62)',
    core: 'rgba(255, 210, 130, 0.92)',
    mark: 'rgba(255, 255, 255, 0.85)',
    pad: 'rgba(0, 190, 255, 0.32)',
    station: 'rgba(255, 200, 110, 0.95)',
  },
  future: {
    glow: 'rgba(0, 120, 180, 0.07)',
    ribbon: 'rgba(35, 58, 82, 0.42)',
    rim: 'rgba(55, 85, 115, 0.38)',
    core: 'rgba(90, 120, 150, 0.32)',
    mark: 'rgba(160, 185, 210, 0.22)',
    pad: 'rgba(40, 65, 90, 0.28)',
    station: 'rgba(70, 95, 120, 0.55)',
  },
};

function stopLabel(status: StopStatus): string {
  if (status === 'watched') return 'Просмотрено';
  if (status === 'done') return 'Пройдено';
  if (status === 'now') return 'Сейчас';
  return 'Будет доступно';
}

function RoadRibbon({ d, tone }: { d: string; tone: RoadTone }) {
  const s = ROAD_TONE_STYLE[tone];
  return (
    <g className={`cab-rm-ribbon is-${tone}`}>
      <path d={d} fill="none" stroke={s.glow} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" filter="url(#cab-rm-glow)" opacity="0.9" />
      <path d={d} fill="none" stroke="rgba(0, 0, 0, 0.42)" strokeWidth="10" strokeLinecap="round" transform="translate(0, 2.5)" opacity="0.55" />
      <path d={d} fill="none" stroke={s.ribbon} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={s.rim} strokeWidth="9" strokeLinecap="round" opacity="0.38" />
      <path d={d} fill="none" stroke="rgba(4, 10, 22, 0.65)" strokeWidth="4.5" strokeLinecap="round" />
      <path d={d} fill="none" stroke={s.core} strokeWidth="1.4" strokeLinecap="round" />
      <path d={d} fill="none" stroke={s.mark} strokeWidth="0.9" strokeDasharray="7 11" strokeLinecap="round" />
    </g>
  );
}

function RoadStations({
  nowIndex,
  locked,
  geometry,
  modules,
  stops,
}: {
  nowIndex: number;
  locked: boolean;
  geometry: RoadmapGeometry;
  modules: { color: string }[];
  stops: CourseStop[];
}) {
  return (
    <g className="cab-rm-stations">
      {geometry.rmPts.map((p, i) => {
        const tone = rmStopTone(i, nowIndex, locked);
        const s = ROAD_TONE_STYLE[tone];
        const modColor = moduleColorAt(modules, stops[i]?.module ?? 0);
        const pad = `${modColor}38`;
        const station = modColor;
        return (
          <g key={`st-${i}`} transform={`translate(${p.x}, ${p.y})`} className={`cab-rm-station is-${tone}`}>
            <ellipse cx="0" cy="0" rx="17" ry="5.5" fill={pad} opacity="0.85" />
            <ellipse cx="0" cy="-0.5" rx="11" ry="3.5" fill={station} opacity={tone === 'future' ? 0.45 : 0.72} />
            <circle r="5.5" fill="rgba(6, 12, 24, 0.88)" stroke={station} strokeWidth="1.6" opacity={tone === 'future' ? 0.55 : 1} />
            <circle r="2.2" fill={tone === 'active' ? 'rgba(255, 200, 110, 0.95)' : 'rgba(180, 230, 255, 0.9)'} opacity={tone === 'future' ? 0.35 : 0.95} />
          </g>
        );
      })}
    </g>
  );
}

function CourseRoadTrack({
  nowIndex,
  locked,
  geometry,
  modules,
  stops,
}: {
  nowIndex: number;
  locked: boolean;
  geometry: RoadmapGeometry;
  modules: { color: string }[];
  stops: CourseStop[];
}) {
  const segments = buildRoadSegments(stops, geometry, nowIndex, locked);
  return (
    <g className="cab-rm-track">
      <defs>
        <filter id="cab-rm-glow" x="-80%" y="-200%" width="260%" height="500%">
          <feGaussianBlur stdDeviation="5.5" />
        </filter>
      </defs>
      {segments.map((seg, idx) => (
        <RoadRibbon key={idx} d={seg.d} tone={seg.tone} />
      ))}
      <RoadStations nowIndex={nowIndex} locked={locked} geometry={geometry} modules={modules} stops={stops} />
    </g>
  );
}

function CourseMap({
  selected,
  onSelect,
  locked,
  allowLockedSelect,
  stops = [],
  modules = [],
}: {
  selected: number;
  onSelect: (id: number) => void;
  locked?: boolean;
  /** Разрешить выбор закрытых остановок (просмотр структуры без доступа к контенту). */
  allowLockedSelect?: boolean;
  stops?: CourseStop[];
  modules?: { name: string; color: string; count: number; about?: string }[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 0, width: 1 });
  const geometry = useMemo(() => buildRoadmapGeometry(stops, modules.length), [stops, modules.length]);
  const nowIndex = locked ? -1 : stops.findIndex((s) => s.status === 'now');

  const syncThumb = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || wrap.scrollWidth <= wrap.clientWidth) {
      setThumb({ left: 0, width: 1 });
      return;
    }
    setThumb({
      left: wrap.scrollLeft / wrap.scrollWidth,
      width: wrap.clientWidth / wrap.scrollWidth,
    });
  }, []);

  useEffect(() => {
    if (stops.length === 0) return;
    const raf = requestAnimationFrame(syncThumb);
    window.addEventListener('resize', syncThumb);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', syncThumb);
    };
  }, [syncThumb, stops.length]);

  const jumpTo = (clientX: number) => {
    const track = trackRef.current;
    const wrap = wrapRef.current;
    if (!track || !wrap) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const max = wrap.scrollWidth - wrap.clientWidth;
    wrap.scrollLeft = Math.min(max, Math.max(0, frac * wrap.scrollWidth - wrap.clientWidth / 2));
  };

  useEffect(() => {
    if (stops.length === 0) return;
    const wrap = wrapRef.current;
    const el = wrap?.querySelector<HTMLElement>(`[data-stop="${selected}"] .cab-rm-node`);
    if (!wrap || !el) return;
    const wrapRect = wrap.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target = Math.max(0, wrap.scrollLeft + (elRect.left - wrapRect.left) - wrap.clientWidth / 2 + elRect.width / 2);
    const from = wrap.scrollLeft;
    const dist = target - from;
    if (Math.abs(dist) < 4) return;
    const dur = 900;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      wrap.scrollLeft = from + dist * ease;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selected, stops.length]);

  if (stops.length === 0) {
    return (
      <div className="cab-roadmap-frame">
        <ComingSoon text="Программа курса скоро появится. Если вы куратор — проверьте, что уроки опубликованы в Sanity." />
      </div>
    );
  }

  return (
    <div className={`cab-roadmap-frame${locked ? ' is-locked' : ''}`}>
      <div className="cab-roadmap" id="cab-roadmap-scroll" ref={wrapRef} onScroll={syncThumb} aria-label="Путь по курсу">
        <div className="cab-roadmap-canvas" style={{ width: geometry.canvasW }}>
          <svg className="cab-roadmap-svg" width={geometry.canvasW} height={geometry.canvasH} aria-hidden="true">
            <CourseRoadTrack
              nowIndex={nowIndex}
              locked={!!locked}
              geometry={geometry}
              modules={modules}
              stops={stops}
            />

            <circle cx={geometry.rmStart.x} cy={geometry.rmStart.y} r="22" className="cab-rm-start-ring" />
            <circle cx={geometry.rmStart.x} cy={geometry.rmStart.y} r="14" className="cab-rm-start-bg" />
            <text x={geometry.rmStart.x} y={geometry.rmStart.y + 36} textAnchor="middle" className="cab-rm-start-label">СТАРТ</text>

            <circle cx={geometry.rmFinish.x} cy={geometry.rmFinish.y} r="22" className="cab-rm-finish-bg" />
            <path d="M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z" className="cab-rm-finish-flag" transform={`translate(${geometry.rmFinish.x - 10} ${geometry.rmFinish.y - 10}) scale(0.62)`} />
            <text x={geometry.rmFinish.x} y={geometry.rmFinish.y - 30} textAnchor="middle" className="cab-rm-finish-label">ФИНИШ</text>
          </svg>

          {stops.map((s, i) => {
            const p = geometry.rmPts[i];
            if (!p) return null;
            const st: StopStatus = locked ? 'locked' : s.status;
            const label = stopLabel(st);
            const modColor = moduleColorAt(modules, s.module);
            return (
              <div
                key={s.id}
                data-stop={s.id}
                className={`cab-rm-stop is-${st} kind-${s.kind}${!locked && selected === s.id ? ' is-selected' : ''}${i % 2 === 0 ? ' plate-top' : ' plate-bottom'}`}
                style={{
                  left: p.x,
                  top: p.y,
                  ['--stop-color' as string]: modColor,
                  ['--stop-glow' as string]: `${modColor}66`,
                  ['--stop-soft' as string]: `${modColor}14`,
                }}
              >
                <span className="cab-rm-stem" aria-hidden="true" />
                <button
                  type="button"
                  className="cab-rm-node"
                  onClick={() => onSelect(s.id)}
                  disabled={st === 'locked' && !allowLockedSelect}
                  title={`${label}: ${s.title}`}
                  aria-label={`${label}: ${s.title}`}
                >
                  {st === 'now' && <span className="cab-rm-ping" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="cab-rm-plate"
                  onClick={() => onSelect(s.id)}
                  disabled={st === 'locked' && !allowLockedSelect}
                >
                  <span className="cab-rm-plate-top">
                    <b>{`M${s.module + 1} · ${s.numInModule}`}</b>
                    <em>{s.date}</em>
                  </span>
                  <span className="cab-rm-title">{s.title}</span>
                  <span className="cab-rm-label">{label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="cab-rm-nav"
        ref={trackRef}
        role="scrollbar"
        aria-controls="cab-roadmap-scroll"
        aria-label="Навигатор по маршруту"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((thumb.left + thumb.width / 2) * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) jumpTo(e.clientX);
        }}
      >
        <div className="cab-rm-nav-track" aria-hidden="true">
          <div className="cab-rm-nav-progress" style={{ width: `${Math.min(100, (thumb.left + thumb.width / 2) * 100)}%` }} />
          {geometry.moduleRanges.map((r, mi) => {
            const pt = geometry.rmPts[r.start];
            if (!pt || !modules[mi]) return null;
            return (
            <i
              key={mi}
              className="cab-rm-nav-mark"
              style={{ left: `${(pt.x / geometry.canvasW) * 100}%`, ['--mark-color' as string]: modules[mi].color }}
            />
            );
          })}
        </div>
        <div
          className="cab-rm-nav-thumb"
          aria-hidden="true"
          style={{ left: `${thumb.left * 100}%`, width: `${Math.max(4, thumb.width * 100)}%` }}
        />
      </div>
    </div>
  );
}

function LivesWidget({
  locked,
  lives,
}: {
  locked?: boolean;
  lives?: { current: number; max: number; accessBlocked: boolean } | null;
}) {
  if (locked || !lives) {
    return (
      <div className={`cab-lives${locked ? ' is-locked' : ''}`} title="Жизни">
        <div className="cab-lives-head">
          <span className="cab-k">Жизни</span>
        </div>
        {locked ? (
          <span className="cab-lives-timer">Откроются после покупки курса</span>
        ) : (
          <span className="cab-lives-timer">—</span>
        )}
      </div>
    );
  }

  const total = lives.max;
  const full = lives.current;
  return (
    <div className="cab-lives" title="Твои жизни">
      <div className="cab-lives-head">
        <span className="cab-k">Жизни</span>
      </div>
      <span className="cab-lives-hearts">
        {Array.from({ length: total }).map((_, i) => (
          <Heart key={i} filled={i < full} />
        ))}
      </span>
      {lives.accessBlocked ? (
        <span className="cab-lives-timer">Связаться с куратором для восстановления доступа</span>
        ) : full < total ? (
        <span className="cab-lives-timer">Восстановление через куратора</span>
      ) : null}
    </div>
  );
}

function ComingSoon({ text }: { text: string }) {
  return (
    <div className="cab-soon">
      <Icon d={ICONS.lock} className="cab-soon-icon" />
      <p>{text}</p>
    </div>
  );
}

type CourseTabId = 'program' | 'homework';

function formatCabinetLessonDate(date: string | null | undefined): string {
  if (!date) return '—';
  const dotted = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const parsed = dotted
    ? new Date(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]))
    : new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function homeworkRowState(stop: CabinetCourseStop, hasCourse: boolean) {
  const lessonLocked = !hasCourse ? stop.status === 'locked' : stop.status === 'locked';
  if (lessonLocked) {
    return { tone: 'locked' as const, label: 'ДЗ не выполнено', action: 'locked' as const };
  }

  const hwNotReady =
    stop.kind === 'webinar' &&
    stop.webinarSessionStatus !== 'completed' &&
    stop.status !== 'watched' &&
    stop.status !== 'done';

  const status: HomeworkProgressStatus = stop.homeworkStatus ?? 'pending';
  if (hwNotReady && (status === 'pending' || !stop.homeworkStatus)) {
    return { tone: 'locked' as const, label: 'Доступно после эфира', action: 'locked' as const };
  }
  if (status === 'approved') {
    return { tone: 'done' as const, label: 'ДЗ выполнено', action: 'view' as const };
  }
  if (status === 'submitted') {
    return { tone: 'pending' as const, label: 'На проверке', action: 'none' as const };
  }
  if (status === 'rejected') {
    return { tone: 'pending' as const, label: 'На доработке', action: 'view' as const };
  }
  return { tone: 'todo' as const, label: 'ДЗ не выполнено', action: 'none' as const };
}

function moduleLegendStatus(
  moduleIndex: number,
  courseStops: CourseStop[],
  moduleRanges: { start: number; end: number }[],
  hasCourse: boolean,
): 'current' | 'done' | 'locked' | 'empty' {
  const range = moduleRanges[moduleIndex];
  if (!range || range.start < 0) return 'empty';
  const stops = courseStops.slice(range.start, range.end + 1);
  if (stops.some((s) => s.status === 'now')) return 'current';
  if (stops.every((s) => s.status === 'done' || s.status === 'watched')) return 'done';
  if (!hasCourse && stops.every((s) => s.status === 'locked')) return 'locked';
  if (stops.some((s) => s.status === 'done' || s.status === 'watched' || s.status === 'now')) return 'done';
  return 'locked';
}

const MODULE_STATUS_LABELS: Record<'current' | 'done' | 'locked' | 'empty', string> = {
  current: 'Текущий',
  done: 'Пройден',
  locked: 'Заблокирован',
  empty: '—',
};

const COURSE_TONES = [
  { accent: '#38c6ff', soft: 'rgba(56, 198, 255, 0.14)', border: 'rgba(56, 198, 255, 0.42)' },
  { accent: '#ff9a2e', soft: 'rgba(255, 154, 46, 0.14)', border: 'rgba(255, 154, 46, 0.42)' },
  { accent: '#8b7cff', soft: 'rgba(139, 124, 255, 0.14)', border: 'rgba(139, 124, 255, 0.42)' },
  { accent: '#3dd68c', soft: 'rgba(61, 214, 140, 0.14)', border: 'rgba(61, 214, 140, 0.42)' },
] as const;

function courseToneAt(index: number) {
  return COURSE_TONES[((index % COURSE_TONES.length) + COURSE_TONES.length) % COURSE_TONES.length]!;
}

type SwitcherCourse = {
  id: number;
  slug: string;
  title: string;
  modulesCount: number;
  purchased: boolean;
};

/* Переключатель «Доступные курсы» — карусель всех курсов каталога. */
function CourseSwitcher({
  courses,
  activeId,
  loading,
  onSelect,
}: {
  courses: SwitcherCourse[];
  activeId: number | null;
  loading?: boolean;
  onSelect: (course: SwitcherCourse) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  if (courses.length < 2) return null;

  const scrollByCard = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.cab-mycourses-card');
    const step = (card?.offsetWidth ?? 220) + 12;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <div className={`cab-mycourses${loading ? ' is-loading' : ''}`} aria-label="Доступные курсы">
      <div className="cab-mycourses-label">
        <span className="cab-mycourses-label-ico" aria-hidden="true">
          <Icon d={ICONS.cap} />
        </span>
        <span className="cab-mycourses-label-text">Доступные курсы</span>
        <span className="cab-mycourses-count">{courses.length}</span>
      </div>

      <div className="cab-mycourses-rail">
        <button
          type="button"
          className="cab-mycourses-arrow"
          aria-label="Предыдущий курс"
          onClick={() => scrollByCard(-1)}
        >
          <Icon d={ICONS.chevronLeft} />
        </button>

        <div className="cab-mycourses-scroller" ref={scrollerRef} role="tablist">
          {courses.map((c, index) => {
            const active = c.id === activeId;
            return (
              <button
                key={c.slug || c.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={loading && !active}
                className={`cab-mycourses-card${active ? ' is-active' : ''}${c.purchased ? ' is-owned' : ''}`}
                onClick={() => onSelect(c)}
              >
                <span className="cab-mycourses-card-ico" aria-hidden="true">
                  <Icon d={index % 2 === 0 ? ICONS.course : ICONS.compass} />
                </span>
                <span className="cab-mycourses-card-copy">
                  <strong>{c.title}</strong>
                  <em>
                    {c.modulesCount > 0
                      ? `${c.modulesCount} ${
                          c.modulesCount === 1 ? 'модуль' : c.modulesCount < 5 ? 'модуля' : 'модулей'
                        }`
                      : 'Программа'}
                  </em>
                </span>
                <span className="cab-mycourses-card-dot" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="cab-mycourses-arrow"
          aria-label="Следующий курс"
          onClick={() => scrollByCard(1)}
        >
          <Icon d={ICONS.chevron} />
        </button>
      </div>
    </div>
  );
}

/* Preview курса — layout как на референсе: hero split + о курсе + программа. */
function CoursePreviewPanel({
  catalog,
  coverUrl,
  toneIndex = 0,
  onEnrollClick,
}: {
  catalog: CabinetCourseCatalog | null;
  coverUrl: string | null;
  toneIndex?: number;
  onEnrollClick: () => void;
}) {
  const tone = courseToneAt(toneIndex);
  const [openModule, setOpenModule] = useState<number | null>(null);
  const title = catalog?.title?.trim() || null;
  const headline = catalog?.cabinetEyebrow?.trim() || null;
  const description = catalog?.description?.trim() || null;
  const modules = catalog?.modulePreviews?.length ? catalog.modulePreviews : [];
  const totalLessons = catalog?.totalLessons || modules.reduce((sum, m) => sum + m.count, 0);
  const teacherName = catalog?.curatorName?.trim() || null;
  const delivery = catalog?.deliveryFormat?.trim() || null;
  const coverImage =
    catalog?.coverImageUrl ?? catalog?.previewImageUrl ?? coverUrl ?? null;
  const insideItems = (catalog?.previewInsideItems ?? []).filter((item) => item.title.trim());
  const featureIcons = [ICONS.target, ICONS.brain, ICONS.shield, ICONS.star];
  const featureColors = ['#3ec6ff', '#7ec8ff', '#34d399', '#5ad0ff'];

  const meta = [
    modules.length > 0
      ? { icon: ICONS.course, label: `${modules.length} ${modules.length === 1 ? 'модуль' : modules.length < 5 ? 'модуля' : 'модулей'}` }
      : null,
    totalLessons > 0
      ? { icon: ICONS.schedule, label: `${totalLessons} ${pluralLessons(totalLessons)}` }
      : null,
    delivery ? { icon: ICONS.screen, label: delivery } : null,
    teacherName ? { icon: ICONS.users, label: teacherName } : null,
  ].filter(Boolean) as { icon: string; label: string }[];

  return (
    <div
      className="cab-cpv"
      style={
        {
          ['--cab-course-accent']: tone.accent,
          ['--cab-course-soft']: tone.soft,
          ['--cab-course-border']: tone.border,
        } as CSSProperties
      }
    >
      <section className={`cab-cpv-hero${coverImage ? ' has-cover' : ''}`}>
        <div
          className="cab-cpv-hero-media"
          style={coverImage ? ({ ['--cab-cpv-cover']: `url("${coverImage}")` } as CSSProperties) : undefined}
          aria-hidden="true"
        />
        <div className="cab-cpv-hero-copy">
          {title ? <span className="cab-cpv-kicker">{title}</span> : null}
          <h2>{sanityText(headline || title)}</h2>
          {description ? <p className="cab-cpv-lead">{description}</p> : null}
          {meta.length > 0 ? (
            <ul className="cab-cpv-meta">
              {meta.map((item) => (
                <li key={item.label}>
                  <Icon d={item.icon} />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="cab-cpv-cta" onClick={onEnrollClick}>
            Открыть курс
            <Icon d={ICONS.chevron} />
          </button>
        </div>
      </section>

      {insideItems.length > 0 ? (
        <section className="cab-cpv-overview">
          <header className="cab-cpv-inside-head">
            <h3>Что внутри курса</h3>
          </header>
          <ul className="cab-cpv-features">
            {insideItems.map((item, index) => {
              const color = featureColors[index % featureColors.length]!;
              return (
                <li key={`${item.title}-${index}`}>
                  <span
                    className="cab-cpv-feature-ico"
                    style={
                      {
                        color,
                        ['--cab-feature-glow']: color,
                      } as CSSProperties
                    }
                  >
                    <Icon d={featureIcons[index % featureIcons.length]!} strokeWidth={1.6} />
                  </span>
                  <strong>{item.title}</strong>
                  {item.description ? <em>{item.description}</em> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section
        className={`cab-cpv-program${coverImage ? ' has-bg' : ''}`}
        style={coverImage ? ({ ['--cab-cpv-cover']: `url("${coverImage}")` } as CSSProperties) : undefined}
      >
        <header className="cab-cpv-program-head">
          <h3>Программа курса</h3>
        </header>
        {modules.length > 0 ? (
          <ul className="cab-cpv-program-list">
            {modules.map((m, mi) => {
              const isOpen = openModule === mi;
              return (
                <li key={`${m.name}-${mi}`} className={isOpen ? 'is-open' : ''}>
                  <button
                    type="button"
                    className="cab-cpv-program-row"
                    aria-expanded={isOpen}
                    onClick={() => setOpenModule(isOpen ? null : mi)}
                  >
                    <span
                      className="cab-cpv-program-num"
                      style={{ borderColor: m.color, color: m.color, boxShadow: `0 0 12px ${m.color}55` }}
                    >
                      {String(mi + 1).padStart(2, '0')}
                    </span>
                    <span className="cab-cpv-program-copy">
                      <strong>{m.name}</strong>
                      <em>
                        {m.count} {pluralLessons(m.count)}
                      </em>
                    </span>
                    <Icon d={ICONS.chevron} className="cab-cpv-program-chev" />
                  </button>
                  {isOpen && m.lessons.length > 0 ? (
                    <ul className="cab-cpv-program-lessons">
                      {m.lessons.map((lesson, li) => (
                        <li key={`${lesson.title}-${li}`}>
                          <span className="cab-cpv-program-lesson-num">
                            {String(li + 1).padStart(2, '0')}
                          </span>
                          <span className="cab-cpv-program-lesson-title">{lesson.title}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="cab-note">Программа появится, когда в Sanity добавят модули курса.</p>
        )}
      </section>
    </div>
  );
}

function homeworkReviewText(stop: CabinetCourseStop): string {
  if (stop.homeworkReviewNote?.trim()) return stop.homeworkReviewNote.trim();
  if (stop.homeworkStatus === 'rejected') {
    return 'Куратор вернул домашнее задание на доработку. Комментарий не указан.';
  }
  return 'Домашнее задание принято куратором.';
}

function HomeworkReviewModal({
  stop,
  onClose,
}: {
  stop: CabinetCourseStop | null;
  onClose: () => void;
}) {
  if (!stop) return null;
  const isApproved = stop.homeworkStatus === 'approved';
  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal cab-modal--enroll"
        role="dialog"
        aria-labelledby="hw-review-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cab-modal-icon" aria-hidden="true">
          <Icon d={ICONS.file} />
        </span>
        <h3 id="hw-review-title">{stop.title}</h3>
        <p className={`cab-hw-review-status is-${isApproved ? 'done' : 'pending'}`}>
          {isApproved ? 'ДЗ выполнено' : 'На доработке'}
        </p>
        <p>{homeworkReviewText(stop)}</p>
        {stop.homeworkCompletedAt && (
          <p className="cab-hw-review-date">
            {formatCabinetLessonDate(stop.homeworkCompletedAt)}
          </p>
        )}
        <div className="cab-modal-actions">
          <button type="button" className="cab-btn cab-btn--line" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

type PaymentResultKind = 'success' | 'failed';

/** Результат возврата с bePaid: /cabinet?payment=success|failed */
function PaymentResultModal({
  result,
  onClose,
  onRetry,
  onGoCourse,
}: {
  result: PaymentResultKind | null;
  onClose: () => void;
  onRetry: () => void;
  onGoCourse: () => void;
}) {
  if (!result) return null;
  const ok = result === 'success';
  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`cab-modal cab-modal--enroll cab-modal--payment is-${result}`}
        role="dialog"
        aria-labelledby="payment-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cab-modal-icon" aria-hidden="true">
          <Icon d={ok ? ICONS.check : ICONS.x} />
        </span>
        <h3 id="payment-result-title">{ok ? 'Оплата прошла' : 'Оплата не завершена'}</h3>
        <p>
          {ok
            ? 'Спасибо! Платёж принят. Доступ к курсу обновится в кабинете после подтверждения.'
            : 'Платёж не прошёл или был отменён. Можно попробовать ещё раз или написать в поддержку.'}
        </p>
        <div className="cab-modal-actions">
          {ok ? (
            <>
              <button type="button" className="cab-btn cab-btn--join" onClick={onGoCourse}>
                К курсу <Icon d={ICONS.chevron} />
              </button>
              <button type="button" className="cab-btn cab-btn--line" onClick={onClose}>
                Закрыть
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cab-btn cab-btn--join" onClick={onRetry}>
                Повторить оплату
              </button>
              <a
                className="cab-btn cab-btn--line"
                href={tgBotUrl('support')}
                target="_blank"
                rel="noopener noreferrer"
              >
                Поддержка
              </a>
              <button type="button" className="cab-btn cab-btn--line" onClick={onClose}>
                Закрыть
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* Модал подтверждения записи на курс. */
function EnrollConfirmModal({
  open,
  courseTitle,
  enrolling,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  courseTitle: string;
  enrolling: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="cab-modal cab-modal--enroll"
        role="dialog"
        aria-labelledby="enroll-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cab-modal-icon" aria-hidden="true">
          <Icon d={ICONS.course} />
        </span>
        <h3 id="enroll-modal-title">Посмотреть карту курса?</h3>
        <p>
          Запишись на «{courseTitle}», чтобы открыть карту курса с программой занятий. Полный доступ к материалам
          появится после покупки.
        </p>
        {error && <p className="cab-modal-error">{error}</p>}
        <div className="cab-modal-actions">
          <button type="button" className="cab-btn cab-btn--line" onClick={onCancel} disabled={enrolling}>
            Отмена
          </button>
          <button type="button" className="cab-btn cab-btn--join" onClick={onConfirm} disabled={enrolling}>
            {enrolling ? 'Открываем…' : 'Посмотреть карту курса'} <Icon d={ICONS.chevron} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CabinetShell({
  data,
  initialSection,
  initialPaymentResult,
  showCabinetPick,
}: {
  data: CabinetData;
  initialSection?: SectionId;
  /** Return URL bePaid: ?payment=success|failed */
  initialPaymentResult?: PaymentResultKind;
  /** Создатель из ADMIN_TELEGRAM_IDS — ссылка на выбор кабинета. */
  showCabinetPick?: boolean;
}) {
  const router = useRouter();
  const normalizedInitial: SectionId =
    initialSection === 'course' || initialSection === 'payments' || initialSection === 'settings'
      ? initialSection
      : 'course';
  const [section, setSection] = useState<SectionId>(normalizedInitial);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [hwReviewStop, setHwReviewStop] = useState<CabinetCourseStop | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResultKind | null>(
    initialPaymentResult ?? null,
  );
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('cab-app');
    document.body.classList.add('cab-app');
    return () => {
      document.documentElement.classList.remove('cab-app');
      document.body.classList.remove('cab-app');
    };
  }, []);

  useEffect(() => {
    const open = menuOpen || asideOpen;
    document.body.classList.toggle('cab-drawer-open', open);
    return () => document.body.classList.remove('cab-drawer-open');
  }, [menuOpen, asideOpen]);

  const clearPaymentQuery = useCallback(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (!params.has('payment')) return;
    params.delete('payment');
    const qs = params.toString();
    router.replace(qs ? `/cabinet?${qs}` : '/cabinet', { scroll: false });
  }, [router]);

  const closePaymentResult = useCallback(() => {
    setPaymentResult(null);
    clearPaymentQuery();
  }, [clearPaymentQuery]);

  useEffect(() => {
    if (!initialPaymentResult) return;
    clearPaymentQuery();
  }, [initialPaymentResult, clearPaymentQuery]);
  const [signingOut, setSigningOut] = useState(false);
  const courseStopsFromDb: CourseStop[] = data.courseStops.map((s) => ({
    id: s.id,
    sanityLessonId: s.sanityLessonId,
    lessonId: s.lessonId,
    module: s.module,
    numInModule: s.numInModule,
    status: s.status,
    kind: s.kind,
    title: s.title,
    date: s.date,
    liveUrl: s.liveUrl,
    recordingUrl: s.recordingUrl,
    description: s.description,
    materials: s.materials,
  }));
  const courseModulesFromCatalog = buildModulesFromCatalogPreviews(data.courseCatalog).map((m) => ({
    name: m.name,
    color: m.color,
    count: m.count,
    about: m.about,
  }));
  const baseCourseModules =
    data.courseModules.length > 0
      ? data.courseModules.map((m) => ({
          name: m.name,
          color: m.color,
          count: m.count,
          about: m.about,
        }))
      : data.courseContent?.modules.length
        ? mapContentToCourseModules(data.courseContent).map((m) => ({
            name: m.name,
            color: m.color,
            count: m.count,
            about: m.about,
          }))
        : courseModulesFromCatalog;
  const cabinetPricing = data.cabinetPricing;
  const courseStopsFromSanity: CourseStop[] = data.courseContent
    ? mapContentToStructureStops(data.courseContent).map((s) => ({
        id: s.id,
        sanityLessonId: s.sanityLessonId,
        lessonId: s.lessonId,
        module: s.module,
        numInModule: s.numInModule,
        status: s.status,
        kind: s.kind,
        title: s.title,
        date: s.date,
        liveUrl: s.liveUrl,
        recordingUrl: s.recordingUrl,
        description: s.description,
        materials: s.materials,
      }))
    : [];
  const courseStopsFromCatalog: CourseStop[] = buildStopsFromCatalogPreviews(data.courseCatalog).map((s) => ({
    id: s.id,
    sanityLessonId: s.sanityLessonId,
    lessonId: s.lessonId,
    module: s.module,
    numInModule: s.numInModule,
    status: s.status,
    kind: s.kind,
    title: s.title,
    date: s.date,
    liveUrl: s.liveUrl,
    recordingUrl: s.recordingUrl,
    description: s.description,
    materials: s.materials,
  }));
  const baseCourseStops =
    courseStopsFromDb.length > 0
      ? courseStopsFromDb
      : courseStopsFromSanity.length > 0
        ? applyCourseProgress(courseStopsFromSanity, data.courseProgress)
        : courseStopsFromCatalog;

  const [stopId, setStopId] = useState<number>(
    () => baseCourseStops.find((s) => s.status === 'now')?.id ?? baseCourseStops[0]?.id ?? 0,
  );
  const [courseTab, setCourseTab] = useState<CourseTabId>('program');
  const [activeCourseId, setActiveCourseId] = useState<number | null>(
    () => data.courseCatalog?.id ?? data.enrollment?.courseId ?? null,
  );
  const [courseSlice, setCourseSlice] = useState<CabinetCourseViewSlice | null>(null);
  const [courseSwitching, setCourseSwitching] = useState(false);
  const courseCacheRef = useRef<Map<string, CabinetCourseViewSlice>>(new Map());

  useEffect(() => {
    if (!data.courseCatalog?.slug) return;
    courseCacheRef.current.set(data.courseCatalog.slug, {
      slug: data.courseCatalog.slug,
      courseCatalog: data.courseCatalog,
      courseModules: data.courseModules,
      courseStops: data.courseStops,
      courseProgress: data.courseProgress,
      lives: data.lives,
      enrollment: data.enrollment,
    });
  }, [
    data.courseCatalog,
    data.courseModules,
    data.courseStops,
    data.courseProgress,
    data.lives,
    data.enrollment,
  ]);

  useEffect(() => {
    const nextId = data.courseCatalog?.id ?? data.enrollment?.courseId ?? null;
    setActiveCourseId(nextId);
    const slug = data.courseCatalog?.slug;
    if (!slug) return;
    const cached = courseCacheRef.current.get(slug);
    if (cached) {
      setCourseSlice(cached);
      setStopId(
        cached.courseStops.find((s) => s.status === 'now')?.id ?? cached.courseStops[0]?.id ?? 0,
      );
    }
  }, [data.courseCatalog?.id, data.courseCatalog?.slug, data.enrollment?.courseId]);
  const [pkgHistoryAll, setPkgHistoryAll] = useState(false);
  const [profileSaved, setProfileSaved] = useState({
    name: data.profile?.name ?? '',
    klass: data.profile?.klass ?? '10',
    goal: data.profile?.goal ?? 'Подготовка к ЦТ',
    resultType: (data.profile?.resultType ?? 'ct') as 'ct' | 'grade',
    resultValue: data.profile?.resultValue ?? null,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<{ name: string; klass: string; goal: string; resultType: 'ct' | 'grade'; resultValue: number | null } | null>(null);

  const displayName = profileSaved.name || data.studentName || 'Ученик';
  const days = daysInSystem(data.createdAt);
  const courseCabinetGate = shouldShowCourseCabinetGate(data);
  const noCourseCatalog = !hasCourseCatalogOffer(data);
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
  const courseChoices = useMemo(() => {
    const catalogs =
      data.courseCatalogs?.length > 0
        ? data.courseCatalogs
        : data.courseCatalog
          ? [data.courseCatalog]
          : [];
    const enrollByCourse = new Map(
      (data.courseEnrollments ?? []).map((e) => [e.courseId, e.startedAt] as const),
    );
    const ownedCount = catalogs.filter((c) => enrollByCourse.has(c.id)).length;

    const mapped: SwitcherCourse[] = catalogs.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      modulesCount: c.modulesCount || c.modulePreviews?.length || 0,
      purchased: enrollByCourse.has(c.id),
    }));

    // 1 куплен → он первый; иначе — по дате покупки (раньше выше); без покупок — порядок каталога.
    return mapped
      .map((course, index) => ({ course, index }))
      .sort((a, b) => {
        const aAt = enrollByCourse.get(a.course.id);
        const bAt = enrollByCourse.get(b.course.id);
        if (ownedCount === 1) {
          if (a.course.purchased !== b.course.purchased) {
            return a.course.purchased ? -1 : 1;
          }
        }
        if (aAt && bAt) {
          const byDate = aAt.localeCompare(bAt);
          if (byDate !== 0) return byDate;
        } else if (aAt && !bAt) {
          return -1;
        } else if (!aAt && bAt) {
          return 1;
        }
        return a.index - b.index;
      })
      .map(({ course }) => course);
  }, [data.courseCatalogs, data.courseCatalog, data.courseEnrollments]);

  // Доступ — по enrollment активного курса (slice только если он уже про этот курс).
  const activeCourseOwned =
    courseSlice?.courseCatalog?.id === activeCourseId
      ? courseSlice.enrollment != null
      : courseChoices.find((c) => c.id === activeCourseId)?.purchased === true;
  const courseState: CourseCabinetState = activeCourseOwned
    ? getCourseCabinetState(data)
    : 'preview';

  const activeCatalogIndex = Math.max(
    0,
    courseChoices.findIndex((c) => c.id === activeCourseId),
  );
  const sliceMatchesActive = courseSlice?.courseCatalog?.id === activeCourseId;
  const activeCatalog =
    (sliceMatchesActive ? courseSlice?.courseCatalog : null) ??
    (data.courseCatalog && data.courseCatalog.id === activeCourseId
      ? data.courseCatalog
      : null) ??
    data.courseCatalogs.find((c) => c.id === activeCourseId) ??
    data.courseCatalog;

  const catalogModulesFallback =
    activeCatalog?.modulePreviews?.map((m) => ({
      name: m.name,
      color: m.color,
      count: m.count,
      about: m.about,
    })) ?? [];

  const courseModules = sliceMatchesActive
    ? courseSlice!.courseModules.map((m) => ({
        name: m.name,
        color: m.color,
        count: m.count,
        about: m.about,
      }))
    : data.courseCatalog?.id === activeCourseId
      ? baseCourseModules
      : catalogModulesFallback;

  const courseStops: CourseStop[] = sliceMatchesActive
    ? courseSlice!.courseStops.map((s) => ({
        id: s.id,
        sanityLessonId: s.sanityLessonId,
        lessonId: s.lessonId,
        module: s.module,
        numInModule: s.numInModule,
        status: s.status,
        kind: s.kind,
        title: s.title,
        date: s.date,
        liveUrl: s.liveUrl,
        recordingUrl: s.recordingUrl,
        description: s.description,
        materials: s.materials,
      }))
    : data.courseCatalog?.id === activeCourseId
      ? baseCourseStops
      : [];

  const cabinetCourseStops = sliceMatchesActive
    ? (courseSlice?.courseStops ?? data.courseStops)
    : data.courseCatalog?.id === activeCourseId
      ? data.courseStops
      : [];
  const displayLives = sliceMatchesActive
    ? (courseSlice?.lives ?? data.lives)
    : data.courseCatalog?.id === activeCourseId
      ? data.lives
      : null;

  const moduleRanges = (() => {
    return courseModules.map((_, moduleIndex) => {
      let start = -1;
      let end = -1;
      courseStops.forEach((s, i) => {
        if (s.module !== moduleIndex) return;
        if (start < 0) start = i;
        end = i;
      });
      return { start, end };
    });
  })();
  const courseDoneCount = courseStops.filter((s) => s.status === 'done' || s.status === 'watched').length;
  const courseProgressPct = courseStops.length > 0 ? Math.round((courseDoneCount / courseStops.length) * 100) : 0;

  const syncCourseUrl = useCallback((slug: string) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'course');
    if (slug) params.set('course', slug);
    params.delete('payment');
    // replaceState — без RSC-рефетча всей страницы кабинета (router.replace тормозит).
    window.history.replaceState(window.history.state, '', `/cabinet?${params.toString()}`);
  }, []);

  const fetchCourseSlice = useCallback(async (slug: string) => {
    const res = await fetch(`/api/cabinet/course/view?course=${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('course view failed');
    const slice = (await res.json()) as CabinetCourseViewSlice;
    courseCacheRef.current.set(slug, slice);
    return slice;
  }, []);

  const selectCourse = useCallback(
    async (course: SwitcherCourse | { id: number; slug: string; title: string }) => {
      if (course.id === activeCourseId || courseSwitching) return;
      setActiveCourseId(course.id);
      setSection('course');
      syncCourseUrl(course.slug);

      const cached = courseCacheRef.current.get(course.slug);
      if (cached) {
        setCourseSlice(cached);
        const nextStop =
          cached.courseStops.find((s) => s.status === 'now')?.id ?? cached.courseStops[0]?.id ?? 0;
        setStopId(nextStop);
        return;
      }

      // Сразу сбрасываем чужой slice: без покупки сразу preview по каталогу, без ожидания API.
      const owned = 'purchased' in course ? course.purchased : false;
      setCourseSlice(null);
      if (!owned) {
        setCourseSwitching(false);
      } else {
        setCourseSwitching(true);
      }

      try {
        const slice = await fetchCourseSlice(course.slug);
        setCourseSlice(slice);
        const nextStop =
          slice.courseStops.find((s) => s.status === 'now')?.id ?? slice.courseStops[0]?.id ?? 0;
        setStopId(nextStop);
      } catch (error) {
        console.error('[cabinet] course switch failed:', error);
      } finally {
        setCourseSwitching(false);
      }
    },
    [activeCourseId, courseSwitching, fetchCourseSlice, syncCourseUrl],
  );

  // Прогрев остальных курсов в фоне — первое переключение не ждёт Sanity.
  useEffect(() => {
    const pending = courseChoices
      .filter((c) => c.slug && c.id !== activeCourseId && !courseCacheRef.current.has(c.slug))
      .slice(0, 4);
    if (pending.length === 0) return;

    let cancelled = false;
    const run = () => {
      void (async () => {
        for (const course of pending) {
          if (cancelled) return;
          try {
            await fetchCourseSlice(course.slug);
          } catch {
            /* ignore prefetch errors */
          }
        }
      })();
    };

    const ric = window.requestIdleCallback?.bind(window);
    const usedIdle = typeof ric === 'function';
    const idleId = usedIdle ? ric(run, { timeout: 1800 }) : window.setTimeout(run, 400);
    return () => {
      cancelled = true;
      if (usedIdle) {
        window.cancelIdleCallback?.(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [activeCourseId, courseChoices, fetchCourseSlice]);

  const courseName = activeCatalog?.title ?? data.courseContent?.title ?? null;
  const courseHeadline = activeCatalog?.cabinetEyebrow ?? data.courseContent?.cabinetEyebrow ?? null;
  const courseDescription = activeCatalog?.description ?? data.courseContent?.description ?? null;
  const courseTeacherName = activeCatalog?.curatorName ?? data.courseContent?.curatorName ?? null;
  const totalCourseLessons =
    activeCatalog?.totalLessons ||
    courseModules.reduce((sum, m) => sum + m.count, 0) ||
    courseStops.length;
  const courseDelivery = activeCatalog?.deliveryFormat ?? data.courseContent?.deliveryFormat ?? null;
  const homeworkIntro = activeCatalog?.homeworkIntro ?? data.courseContent?.homeworkIntro ?? null;
  const courseCoverUrl =
    activeCatalog?.coverImageUrl ??
    activeCatalog?.previewImageUrl ??
    (data.courseCatalog?.id === activeCourseId
      ? (data.courseContent?.coverImageUrl ?? data.courseContent?.previewImageUrl ?? null)
      : null);
  const mapCourseStops = courseStops;
  const activeTone = courseToneAt(activeCatalogIndex);

  const myPackages = data.packages;
  const pkgHistory = data.payments;
  const coursePackage = myPackages.find((p) => p.product === 'course');
  const coursePaymentHistory = pkgHistory.filter(
    (h) =>
      h.title.toLowerCase().includes('курс') ||
      (coursePackage?.title && h.title.includes(coursePackage.title)),
  );

  const emptyStopModule = { name: '—', color: '#ccc', count: 0, about: '' };
  const stop = courseStops.find((s) => s.id === stopId) ?? courseStops[0] ?? null;
  const stopModule = stop
    ? (courseModules[stop.module] ?? courseModules[0] ?? emptyStopModule)
    : emptyStopModule;
  const selectedCabinetStop = cabinetCourseStops.find((s) => s.id === stopId) ?? cabinetCourseStops[0];
  const trialStopId = courseStops.find((s) => s.status !== 'locked')?.id ?? courseStops[0]?.id ?? 1;
  const hasCourse = courseState === 'full';

  /* ——— Настройки профиля ——— */
  /* TEMP: класс и цель пока хранятся локально — для записи в базу потребуется
     соответствующее поле/API в Supabase (сейчас возвращаются только имя и телефон). */
  const profileName = profileSaved.name || data.studentName || 'Ученик';
  const studentId = `#${data.phone.replace(/\D/g, '').slice(-5).padStart(5, '0')}`;
  const profileScoreLabel =
    profileSaved.resultValue != null
      ? profileSaved.resultType === 'grade'
        ? `Оценка ${profileSaved.resultValue}`
        : `${profileSaved.resultValue} баллов РТ`
      : '—';

  const examSettings = data.cabinetPricing.exam;
  const examDate = examSettings ? new Date(`${examSettings.date}T12:00:00`) : null;
  const examDaysLeft =
    examDate && !Number.isNaN(examDate.getTime())
      ? Math.max(0, Math.ceil((examDate.getTime() - Date.now()) / 86_400_000))
      : null;
  const examDateLabel =
    examDate && !Number.isNaN(examDate.getTime())
      ? examDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
  const achievementViews = buildAchievementViews(data);
  const achievementsUnlocked = achievementViews.filter((item) => item.unlocked).length;

  async function saveProfile() {
    if (!profileDraft) return;
    setProfileSaving(true);
    setProfileSaveError(null);
    try {
      const res = await fetch('/api/cabinet/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDraft),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setProfileSaveError(payload?.error ?? 'Не удалось сохранить профиль. Попробуй ещё раз.');
        return;
      }
      setProfileSaved(profileDraft);
      setProfileDraft(null);
    } finally {
      setProfileSaving(false);
    }
  }

  function startProfileEdit() {
    setProfileDraft({
      name: profileName,
      klass: profileSaved.klass || GRADES[5],
      goal: STUDY_GOALS.includes(profileSaved.goal) ? profileSaved.goal : STUDY_GOALS[2],
      resultType: profileSaved.resultType,
      resultValue: profileSaved.resultValue,
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  /** Отметить просмотр — вызывается при старте плеера внутри карточки занятия. */
  async function markLessonWatched(phase: 'upcoming' | 'live' | 'recording') {
    const detail = cabinetCourseStops.find((s) => s.id === stopId);
    if (!detail?.sanityLessonId) return;
    const endpoint = phase === 'live' ? 'watch-live' : 'watch-recording';
    await fetch(`/api/cabinet/course/lessons/${encodeURIComponent(detail.sanityLessonId)}/${endpoint}`, {
      method: 'POST',
    });
    router.refresh();
  }

  /** «Открыть занятие» — полноценная страница урока. */
  function openCourseLesson() {
    const detail = cabinetCourseStops.find((s) => s.id === stopId);
    if (!detail) return;
    router.push(lessonPathForStop(detail));
  }

  useEffect(() => {
    const detail = cabinetCourseStops.find((s) => s.id === stopId);
    if (!detail) return;
    router.prefetch(lessonPathForStop(detail));
  }, [cabinetCourseStops, router, stopId]);

  async function confirmEnroll() {
    setEnrolling(true);
    setEnrollError(null);
    try {
      const res = await fetch('/api/cabinet/course/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: activeCatalog?.id ?? data.courseCatalog?.id ?? data.enrollment?.courseId,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setEnrollError(payload?.error ?? 'Не удалось записаться на курс. Попробуй ещё раз.');
        return;
      }
      setEnrollOpen(false);
      router.refresh();
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <div className={`cabinet${menuOpen || asideOpen ? ' is-drawer-open' : ''}`}>
      <div className={`cab-backdrop${menuOpen || asideOpen ? ' is-open' : ''}`} onClick={() => { setMenuOpen(false); setAsideOpen(false); }} />

      <aside className={`cab-sidebar${menuOpen ? ' is-open' : ''}`}>
        <button type="button" className="cab-brand" onClick={() => router.push('/')} title="Вернуться на сайт">
          <span className="logo-icon" aria-hidden="true" />
          <span className="cab-brand-name">DISTRICT</span>
        </button>
        <nav className="cab-nav" aria-label="Разделы кабинета">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="cab-nav-group">
              <span className="cab-nav-head">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cab-nav-item${section === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSection(item.id);
                    setMenuOpen(false);
                  }}
                >
                  <Icon d={ICONS[item.icon]} className="cab-nav-icon" strokeWidth={1.4} />
                  <span className="cab-nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="cab-sidebar-footer">
          {examSettings && examDaysLeft != null && examDateLabel && (
            <div className="cab-exam-countdown" suppressHydrationWarning>
              <span className="cab-exam-medal" aria-hidden="true">
                <Icon d={ICONS.target} strokeWidth={1.5} />
              </span>
              <div className="cab-exam-text">
                <span className="cab-k">{examSettings.label}</span>
                <span className="cab-exam-fire" aria-hidden="true">🔥</span>
                <strong>
                  {examDaysLeft}
                  <em> {pluralDays(examDaysLeft)}</em>
                </strong>
                <span className="cab-exam-sub">{examDateLabel}</span>
              </div>
              <Icon d={ICONS.chevron} className="cab-exam-chevron" strokeWidth={1.6} />
            </div>
          )}
          {showCabinetPick ? (
            <a href="/cabinet/pick" className="cab-nav-item cab-pick-link">
              Выбор кабинета
            </a>
          ) : null}
          <p className="cab-sidebar-tagline">
            Больше, чем просто уроки
            <Icon d={ICONS.feather} className="cab-sidebar-tagline-ico" strokeWidth={1.4} />
          </p>
        </div>
      </aside>

      <div className="cab-main">
        <header className="cab-pagehead">
          {/* тогглы сайдбаров — часть шапки на мобильных */}
          <button
            type="button"
            className="cab-side-toggle is-left"
            onClick={() => {
              setMenuOpen(true);
              setAsideOpen(false);
            }}
            aria-label="Открыть меню"
          >
            <Icon d={ICONS.burger} />
          </button>
          <a className="cab-home-link" href="/" title="Вернуться на главную">
            <Icon d={ICONS.back} />
            <h1>Кабинет курса</h1>
          </a>
          <button
            type="button"
            className={`cab-side-toggle is-right${asideOpen ? ' is-open' : ''}`}
            onClick={() => {
              setAsideOpen((v) => !v);
              setMenuOpen(false);
            }}
            aria-label="Профиль и достижения"
          >
            <Icon d={ICONS.users} />
          </button>
        </header>

        <div className="cab-body">
          <main className="cab-content">
            {section === 'course' && courseCabinetGate && (
              <CourseCabinetGate
                courseTitle={courseName}
                botUrl={botUrl}
                noCatalog={noCourseCatalog}
                onOpenPayments={() => setSection('payments')}
              />
            )}

            {section === 'course' && !courseCabinetGate && courseState === 'preview' && (
              <div className="cab-stack cab-course-screen">
                <CourseSwitcher
                  courses={courseChoices}
                  activeId={activeCourseId}
                  loading={courseSwitching}
                  onSelect={selectCourse}
                />
                <div className={courseSwitching ? 'cab-course-view is-switching' : 'cab-course-view'}>
                  <CoursePreviewPanel
                    catalog={activeCatalog}
                    toneIndex={activeCatalogIndex}
                    coverUrl={
                      activeCatalog?.coverImageUrl ?? activeCatalog?.previewImageUrl ?? null
                    }
                    onEnrollClick={() => { setEnrollError(null); setEnrollOpen(true); }}
                  />
                </div>
              </div>
            )}

            {section === 'course' && !courseCabinetGate && courseState !== 'preview' && (
              <div className="cab-stack cab-course-screen">
                <CourseSwitcher
                  courses={courseChoices}
                  activeId={activeCourseId}
                  loading={courseSwitching}
                  onSelect={selectCourse}
                />
                <section
                  className={`cab-panel cab-course-shell${courseSwitching ? ' is-switching' : ''}`}
                  style={
                    {
                      ['--cab-course-accent']: activeTone.accent,
                      ['--cab-course-soft']: activeTone.soft,
                      ['--cab-course-border']: activeTone.border,
                    } as CSSProperties
                  }
                >
                  <div className="cab-course-hero">
                    <div className="cab-course-hero-main">
                      <div className="cab-course-hero-cover" aria-hidden="true">
                        {courseCoverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={courseCoverUrl} alt="" className="cab-course-hero-cover-img" />
                        ) : null}
                      </div>
                      <div className="cab-course-hero-copy">
                        <div className="cab-course-hero-title-row">
                          <span className="cab-course-hero-title">{sanityText(courseName)}</span>
                          {hasCourse && (
                            <div className="cab-course-hero-badge">
                              <Icon d={ICONS.check} />
                              <span>Вы записаны на курс</span>
                            </div>
                          )}
                        </div>
                        <h2>{sanityText(courseHeadline)}</h2>
                        <p>{sanityText(courseDescription)}</p>
                      </div>
                    </div>
                    <ul className="cab-course-hero-meta">
                      <li><Icon d={ICONS.course} />{courseModules.length} модулей</li>
                      <li><Icon d={ICONS.screen} />{totalCourseLessons} занятий</li>
                      <li><Icon d={ICONS.play} />{sanityText(courseDelivery)}</li>
                      <li><Icon d={ICONS.users} />Преподаватель: {sanityText(courseTeacherName)}</li>
                    </ul>
                  </div>

                  <div className="cab-course-tabs" role="tablist" aria-label="Разделы курса">
                    {([
                      { id: 'program' as const, label: 'Программа' },
                      { id: 'homework' as const, label: 'Домашние задания' },
                    ]).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={courseTab === tab.id}
                        className={`cab-course-tab${courseTab === tab.id ? ' is-active' : ''}`}
                        onClick={() => setCourseTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {courseTab === 'program' && (
                    <div className="cab-course-map-block">
                      <div className="cab-path-scene">
                        <div className="cab-path-float cab-path-float--head">
                          <div className="cab-path-map-head">
                            <h3 className="cab-path-map-title">Твой путь по курсу</h3>
                            <div className="cab-path-head cab-path-head--map">
                              <div className="cab-path-progress">
                                <span className="cab-k">Твой прогресс</span>
                                <strong>{hasCourse ? `${courseProgressPct}%` : '0%'}</strong>
                                <span className="cab-path-sub">
                                  {hasCourse
                                    ? `${courseDoneCount} из ${courseStops.length} занятий`
                                    : `0 из ${courseStops.length} занятий`}
                                </span>
                                <span className="cab-path-bar" aria-hidden="true">
                                  <i style={{ width: `${hasCourse ? courseProgressPct : 0}%` }} />
                                </span>
                              </div>
                              <div className="cab-path-topic">
                                <span className="cab-k">Текущая тема</span>
                                <div className="cab-topic-row">
                                  <strong>{stop?.title ?? 'Выбери занятие на карте'}</strong>
                                  {stop && (
                                    <span className="cab-topic-mod">{`M${stop.module + 1} · ${stop.numInModule}`}</span>
                                  )}
                                </div>
                                <p className="cab-topic-desc">
                                  {sanityText(selectedCabinetStop?.description)}
                                </p>
                              </div>
                              <LivesWidget locked={!hasCourse} lives={displayLives} />
                            </div>
                          </div>
                        </div>
                        <CourseMap
                          selected={stopId}
                          onSelect={setStopId}
                          allowLockedSelect={courseState === 'enrolled_locked'}
                          stops={mapCourseStops}
                          modules={courseModules}
                        />
                      </div>
                      <div className="cab-module-legend">
                        {courseModules.map((m, mi) => {
                          const status = moduleLegendStatus(mi, courseStops, moduleRanges, hasCourse);
                          if (status === 'empty') return null;
                          return (
                            <div
                              key={m.name}
                              className={`cab-module-legend-item is-${status}`}
                            >
                              <i style={{ background: m.color }} />
                              <span className="cab-module-legend-code">M{mi + 1}</span>
                              <span className="cab-module-legend-name">{m.name}</span>
                              <em>{MODULE_STATUS_LABELS[status]}</em>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {courseTab === 'homework' && (
                  <div className="cab-hw-panel">
                    <header className="cab-hw-head">
                      <div className="cab-hw-head-main">
                        <h3>
                          <Icon d={ICONS.homework} />
                          Домашние задания
                        </h3>
                        <p>{sanityText(homeworkIntro)}</p>
                      </div>
                      <span className="cab-hw-info">
                        <Icon d={ICONS.info} strokeWidth={1.6} />
                        ДЗ открываются после прохождения вебинара
                      </span>
                    </header>
                    <div className="cab-hw-list">
                      {cabinetCourseStops.map((s) => {
                        const mod = courseModules[s.module];
                        const hw = homeworkRowState(s, hasCourse);
                        return (
                          <article key={s.id} className={`cab-hw-row is-${hw.tone}`}>
                            <div className="cab-hw-index">
                              <strong>{String(s.numInModule).padStart(2, '0')}</strong>
                              <span>{`M${s.module + 1} · ${String(s.numInModule).padStart(2, '0')}`}</span>
                            </div>
                            <div className="cab-hw-thumb" aria-hidden="true">
                              <i style={{ background: mod?.color ?? 'var(--cab-cyan)' }} />
                            </div>
                            <div className="cab-hw-body">
                              <strong>{s.title}</strong>
                              <p>
                                <span>Вебинар</span>
                                <span className="cab-hw-dot" aria-hidden="true">•</span>
                                <span>{formatCabinetLessonDate(s.date)}</span>
                              </p>
                            </div>
                            <span className={`cab-hw-status is-${hw.tone}`}>
                              {hw.tone === 'done' ? <Icon d={ICONS.check} /> : <Icon d={ICONS.clock} />}
                              {hw.label}
                            </span>
                            {hw.action === 'view' ? (
                              <button
                                type="button"
                                className="cab-hw-action is-active"
                                onClick={() => setHwReviewStop(s)}
                              >
                                <Icon d={ICONS.file} />
                                Посмотреть ответ
                                <Icon d={ICONS.chevron} />
                              </button>
                            ) : hw.action === 'locked' ? (
                              <span className="cab-hw-action is-locked">
                                <Icon d={ICONS.file} />
                                Доступно после вебинара
                              </span>
                            ) : hw.tone === 'todo' && s.sanityLessonId ? (
                              <a
                                className="cab-hw-action is-active"
                                href={tgBotUrl(`hw_${s.sanityLessonId}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Icon d={ICONS.homework} />
                                Сдать в Telegram
                                <Icon d={ICONS.chevron} />
                              </a>
                            ) : (
                              <span className="cab-hw-action is-empty" aria-hidden="true" />
                            )}
                          </article>
                        );
                      })}
                      {!cabinetCourseStops.length && (
                        <p className="cab-hw-empty">Домашние задания появятся вместе с программой курса.</p>
                      )}
                    </div>
                  </div>
                )}
                </section>

                {courseTab === 'program' && stop && (
                  hasCourse || stop.status !== 'locked' ? (
                    <section className="cab-panel cab-lesson-panel cab-lesson-panel--v2 cab-lesson-panel--standalone">
                      <header className="cab-lesson-v2-head">
                        <div className="cab-lesson-v2-module">
                          <i style={{ background: stopModule.color }} aria-hidden="true" />
                          <span>{`${String(stop.module + 1).padStart(2, '0')} · ${stopModule.name.toUpperCase()}`}</span>
                        </div>
                        <span className="cab-lesson-v2-sub">
                          Занятие {stop.numInModule} из {stopModule.count}
                        </span>
                        {!hasCourse && stop.id === trialStopId && (
                          <span className="cab-lesson-v2-badge is-trial">Пробное</span>
                        )}
                        {selectedCabinetStop?.isCurrent && hasCourse && (
                          <span className="cab-lesson-v2-badge is-now">Сейчас</span>
                        )}
                        <span className="cab-lesson-v2-badge is-open">Доступно</span>
                      </header>
                      <div key={stop.id} className="cab-lesson-v2-grid cab-anim-pop">
                        <div className="cab-lesson-v2-media">
                          <LessonPlayer
                            title={stop.title}
                            sessionStartsAt={selectedCabinetStop?.sessionStartsAt ?? null}
                            liveUrl={selectedCabinetStop?.liveUrl ?? null}
                            recordingUrl={selectedCabinetStop?.recordingUrl ?? null}
                            webinarSessionStatus={selectedCabinetStop?.webinarSessionStatus ?? null}
                            posterUrl={courseCoverUrl}
                            onNavigate={openCourseLesson}
                          >
                            <div className="cab-lesson-v2-progress">
                              <span className="cab-lesson-v2-bar" aria-hidden="true">
                                <i
                                  style={{
                                    width:
                                      stop.status === 'done'
                                        ? '100%'
                                        : stop.status === 'watched'
                                          ? '100%'
                                          : stop.status === 'now'
                                            ? '35%'
                                            : '0%',
                                  }}
                                />
                              </span>
                              <span className="cab-lesson-v2-time">
                                {stop.status === 'watched' || stop.status === 'done'
                                  ? 'Просмотрено полностью'
                                  : 'Просмотр не начат'}
                              </span>
                              <span className="cab-lesson-v2-watch">
                                {selectedCabinetStop?.recordingUrl
                                  ? 'Запись'
                                  : selectedCabinetStop?.liveUrl
                                    ? 'Трансляция'
                                    : 'Скоро'}
                              </span>
                            </div>
                          </LessonPlayer>
                        </div>
                        <div className="cab-lesson-v2-about">
                          <h4>О чём занятие</h4>
                          <p>{sanityText(selectedCabinetStop?.description)}</p>
                          <ul className="cab-checks cab-checks--v2">
                            {(selectedCabinetStop?.contentChips?.filter(Boolean).length
                              ? selectedCabinetStop!.contentChips.filter(Boolean)
                              : DEFAULT_LESSON_CONTENT_CHIPS
                            ).map((label, chipIndex) => {
                              const done =
                                chipIndex < 3 ||
                                selectedCabinetStop?.homeworkStatus === 'approved' ||
                                stop.status === 'done';
                              return (
                                <li key={label} className={done ? 'is-done' : ''}>
                                  <span className="cab-check-ico">{done ? <Icon d={ICONS.check} /> : <i />}</span>
                                  {label}
                                </li>
                              );
                            })}
                          </ul>
                          <button type="button" className="cab-lesson-v2-cta" onClick={openCourseLesson}>
                            {!hasCourse && stop.id === trialStopId ? 'Открыть пробное занятие' : 'Открыть занятие'}
                            <Icon d={ICONS.chevron} />
                          </button>
                        </div>
                        <div className="cab-lesson-v2-files">
                          <h4>Файлы к занятию</h4>
                          {!(selectedCabinetStop?.materials.length || selectedCabinetStop?.homeworkFiles.length) ? (
                            <div className="cab-lesson-v2-files-empty">
                              <Icon d={ICONS.lock} />
                              <p>Файлы появятся после публикации.</p>
                            </div>
                          ) : (
                            [...(selectedCabinetStop?.materials ?? []), ...(selectedCabinetStop?.homeworkFiles ?? [])].map(
                              (f, i) => (
                                <div key={`${f.fileName ?? f.title}-${i}`} className="cab-file cab-file--v2">
                                  <Icon d={ICONS.file} className="cab-file-ico" />
                                  <span className="cab-file-name">{f.fileName ?? f.title}</span>
                                  {f.url ? (
                                    <a
                                      href={f.url}
                                      className="cab-file-dl"
                                      aria-label={`Скачать ${f.fileName ?? f.title}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Icon d={ICONS.download} />
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      className="cab-file-dl"
                                      aria-label={`Скачать ${f.fileName ?? f.title}`}
                                      disabled
                                    >
                                      <Icon d={ICONS.download} />
                                    </button>
                                  )}
                                </div>
                              ),
                            )
                          )}
                        </div>
                      </div>
                    </section>
                  ) : (
                    <section className="cab-panel cab-course-locked-lesson cab-lesson-panel--standalone">
                      <Icon d={ICONS.lock} className="cab-course-locked-ico" strokeWidth={1.5} />
                      <span className="cab-k">
                        {`${String(stop.module + 1).padStart(2, '0')} · ${stopModule.name.toUpperCase()} — МОДУЛЬ ${stop.module + 1}`}
                      </span>
                      <h3>{stop.title}</h3>
                      <p>
                        Это занятие откроется после покупки курса. Оформи доступ, чтобы смотреть вебинары,
                        скачивать материалы и сдавать домашние задания.
                      </p>
                      <a className="cab-btn cab-btn--join" href={packagesHref()}>
                        <Icon d={ICONS.cart} /> Купить курс
                      </a>
                    </section>
                  )
                )}
              </div>
            )}


            {section === 'payments' && (
              <div className="cab-stack cab-payments-course">
                <header className="cab-pay-pick-head">
                  <span className="cab-pay-pick-ico" aria-hidden="true">
                    <Icon d={ICONS.payments} />
                  </span>
                  <div>
                    <h2>Выбор курса</h2>
                    <p>Выберите курс и удобный способ оплаты</p>
                  </div>
                </header>

                <section
                  className="cab-course-pick-grid"
                  data-count={
                    data.coursePaymentOffers.length === 4
                      ? 4
                      : data.coursePaymentOffers.length === 2
                        ? 2
                        : data.coursePaymentOffers.length === 1
                          ? 1
                          : 3
                  }
                >
                  {data.coursePaymentOffers.length === 0 ? (
                    <p className="cab-note cab-pkg-empty-note">
                      Курсы для оплаты появятся, когда в настройках курса укажут цену и количество занятий.
                    </p>
                  ) : (
                    data.coursePaymentOffers.map((offer, offerIndex) => {
                      const owned = courseChoices.some(
                        (c) => c.slug === offer.slug && c.purchased,
                      );
                      const lessonsLabel = `${offer.grantedLessons} ${
                        offer.grantedLessons === 1
                          ? 'занятие'
                          : offer.grantedLessons < 5
                            ? 'занятия'
                            : 'занятий'
                      }`;
                      return (
                        <article
                          key={offer.sanityId}
                          className={`cab-course-pick-card${owned ? ' is-owned' : ''}`}
                        >
                          <div className="cab-course-pick-body">
                            <span className="cab-course-pick-course-ico" aria-hidden="true">
                              <Icon d={offerIndex % 2 === 0 ? ICONS.spark : ICONS.compass} />
                            </span>
                            <div className="cab-course-pick-main">
                              <div className="cab-course-pick-copy">
                                <strong>{offer.title}</strong>
                                <em>
                                  {offer.cardText?.trim() ||
                                    `Полный доступ к программе · ${lessonsLabel} после оплаты`}
                                </em>
                              </div>
                              <ul className="cab-course-pick-chips">
                                {[
                                  { icon: ICONS.play, label: 'Видео' },
                                  { icon: ICONS.homework, label: 'Задания' },
                                  { icon: ICONS.file, label: 'Материалы' },
                                  { icon: ICONS.results, label: 'Прогресс' },
                                ].map((chip) => (
                                  <li key={chip.label}>
                                    <Icon d={chip.icon} />
                                    {chip.label}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <span className="cab-course-pick-price">
                              <strong>
                                {String(offer.priceByn)} <em>BYN</em>
                              </strong>
                              <small>
                                <Icon d={ICONS.users} />
                                {lessonsLabel}
                              </small>
                            </span>
                          </div>
                          <a className="cab-course-pick-cta" href={checkoutHref(offer.slug)}>
                            <Icon d={ICONS.cart} />
                            Купить пакет
                            <Icon d={ICONS.chevron} />
                          </a>
                        </article>
                      );
                    })
                  )}
                </section>

                <section className="cab-panel cab-mypkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">Ваш пакет курса</span>
                  </header>
                  {coursePackage ? (
                    <div className="cab-course-pkg-summary">
                      <strong>{coursePackage.title}</strong>
                      <p className="cab-note">
                        Осталось оплаченных занятий курса:{' '}
                        <b>
                          {coursePackage.remaining} / {coursePackage.total}
                        </b>{' '}
                        {pluralLessons(coursePackage.total)}
                      </p>
                      {coursePackage.active ? (
                        <span className="cab-pkg-status is-active">
                          <i aria-hidden="true" />
                          Активен
                        </span>
                      ) : (
                        <span className="cab-pkg-status">Завершён</span>
                      )}
                    </div>
                  ) : (
                    <p className="cab-note cab-pkg-empty-note">
                      Пакет курса появится после первой оплаты. Нажми «Купить пакет» выше или оформи заявку через
                      Telegram-бот.
                    </p>
                  )}
                </section>

                <section className="cab-panel cab-pkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">История оплат курса</span>
                    {coursePaymentHistory.length > 2 ? (
                      <button type="button" className="cab-pkg-history-all" onClick={() => setPkgHistoryAll((v) => !v)}>
                        {pkgHistoryAll ? 'Свернуть' : 'Показать все'} <Icon d={ICONS.chevron} />
                      </button>
                    ) : null}
                  </header>
                  {coursePaymentHistory.length === 0 ? (
                    <p className="cab-note cab-pkg-empty-note">Здесь появятся платежи за онлайн-курс.</p>
                  ) : (
                    <ul className="cab-pkg-history">
                      {(pkgHistoryAll ? coursePaymentHistory : coursePaymentHistory.slice(0, 5)).map((h) => (
                        <li key={h.id}>
                          <span className="cab-h-date">{h.date}</span>
                          <span className="cab-h-title">{h.title}</span>
                          <span className="cab-h-price">{h.price} BYN</span>
                          <span
                            className={`cab-h-status${h.status === 'pending' ? ' is-pending' : h.status === 'rejected' ? ' is-rejected' : ''}`}
                          >
                            {h.status === 'pending'
                              ? 'Ожидает оплаты'
                              : h.status === 'rejected'
                                ? 'Отклонено'
                                : 'Оплачено'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}

            {section === 'settings' && (
              <div className="cab-stack">
                <header className="cab-sched-head">
                  <div>
                    <h2>Настройки</h2>
                    <p>Управление аккаунтом и учебными параметрами</p>
                  </div>
                </header>

                {!profileDraft ? (
                  <section className="cab-panel cab-set-block">
                    <header className="cab-set-head">
                      <span className="cab-set-num">01 · Профиль</span>
                      <button type="button" className="cab-set-edit" onClick={startProfileEdit}>
                        <Icon d={ICONS.edit} />
                        Редактировать
                      </button>
                    </header>
                    <div className="cab-set-profile">
                      <div className="cab-set-profile-top">
                        <span className="cab-set-avatar">{initials(profileName)}</span>
                        <div className="cab-set-id">
                          <strong>{profileName}</strong>
                          <span>{data.phone}</span>
                        </div>
                      </div>
                      <dl className="cab-set-facts">
                        <div className="cab-set-fact">
                          <dt>Класс</dt>
                          <dd>{profileSaved.klass ? `${profileSaved.klass} класс` : 'Не указан'}</dd>
                        </div>
                        <div className="cab-set-fact">
                          <dt>Цель обучения</dt>
                          <dd>{profileSaved.goal}</dd>
                        </div>
                        <div className="cab-set-fact">
                          <dt>Текущая успеваемость</dt>
                          <dd>
                            {profileSaved.resultValue === null
                              ? 'Не указана'
                              : profileSaved.resultType === 'ct'
                                ? `${profileSaved.resultValue} баллов РТ`
                                : `Оценка ${profileSaved.resultValue} / 10`}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </section>
                ) : (
                  <form
                    className="cab-panel cab-set-block"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveProfile();
                    }}
                  >
                    <header className="cab-set-head">
                      <span className="cab-set-num">01 · Профиль</span>
                    </header>
                    <div className="cab-set-form cab-set-form--edit">
                      <div className="cab-set-row3">
                        <div className="cab-set-field">
                          <label className="cab-set-label" htmlFor="cab-profile-name">Имя</label>
                          <div className="cab-set-input">
                            <Icon d={ICONS.users} />
                            <input
                              id="cab-profile-name"
                              value={profileDraft.name}
                              onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })}
                              placeholder="Имя и фамилия"
                            />
                          </div>
                        </div>
                        <div className="cab-set-field">
                          <label className="cab-set-label" htmlFor="cab-profile-phone">Телефон</label>
                          <div className="cab-set-input">
                            <Icon d={ICONS.phone} />
                            <input id="cab-profile-phone" value={data.phone} disabled readOnly />
                          </div>
                        </div>
                        <div className="cab-set-field">
                          <span className="cab-set-label">Класс</span>
                          <CabSetSelect
                            icon={ICONS.cap}
                            value={`${profileDraft.klass} класс`}
                            options={GRADES.map((g) => `${g} класс`)}
                            onChange={(v) => setProfileDraft({ ...profileDraft, klass: v.replace(/\s*класс$/, '') })}
                          />
                        </div>
                      </div>
                      <div className="cab-set-duo">
                        <div className="cab-set-field">
                          <span className="cab-set-label">Цель обучения</span>
                          <CabSetSelect
                            icon={ICONS.target}
                            value={profileDraft.goal}
                            options={[...STUDY_GOALS]}
                            onChange={(goal) => setProfileDraft({ ...profileDraft, goal })}
                          />
                        </div>
                        <div className="cab-set-field">
                          <span className="cab-set-label cab-set-label--plain">Текущая успеваемость</span>
                          <div className="cab-set-result">
                            <div className="cab-set-result-type" role="tablist" aria-label="Тип результата">
                              <button
                                type="button"
                                role="tab"
                                aria-selected={profileDraft.resultType === 'ct'}
                                className={`cab-set-result-btn${profileDraft.resultType === 'ct' ? ' is-active' : ''}`}
                                onClick={() =>
                                  setProfileDraft({
                                    ...profileDraft,
                                    resultType: 'ct',
                                    resultValue: profileDraft.resultValue === null ? null : Math.min(100, Math.max(0, profileDraft.resultValue)),
                                  })
                                }
                              >
                                <Icon d={ICONS.results} />
                                Балл РТ
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={profileDraft.resultType === 'grade'}
                                className={`cab-set-result-btn${profileDraft.resultType === 'grade' ? ' is-active' : ''}`}
                                onClick={() =>
                                  setProfileDraft({
                                    ...profileDraft,
                                    resultType: 'grade',
                                    resultValue: profileDraft.resultValue === null ? null : Math.min(10, Math.max(0, profileDraft.resultValue)),
                                  })
                                }
                              >
                                Оценка по предмету
                              </button>
                            </div>
                            <input
                              className="cab-set-result-input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={profileDraft.resultType === 'ct' ? 100 : 10}
                              value={profileDraft.resultValue ?? ''}
                              placeholder={profileDraft.resultType === 'ct' ? '0–100' : '0–10'}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  setProfileDraft({ ...profileDraft, resultValue: null });
                                  return;
                                }
                                const num = Math.round(Number(raw));
                                if (Number.isNaN(num)) return;
                                const max = profileDraft.resultType === 'ct' ? 100 : 10;
                                setProfileDraft({ ...profileDraft, resultValue: Math.min(max, Math.max(0, num)) });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      {profileSaveError && <p className="cab-modal-error">{profileSaveError}</p>}
                      <div className="cab-set-actions">
                        <button type="button" className="cab-btn cab-btn--line" onClick={() => { setProfileDraft(null); setProfileSaveError(null); }}>
                          Отмена
                        </button>
                        <button type="submit" className="cab-btn cab-btn--join cab-set-save" disabled={profileSaving}>
                          {profileSaving ? 'Сохранение…' : 'Сохранить'} <Icon d={ICONS.chevron} />
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                <section className="cab-panel cab-set-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">02 · Аккаунт</span>
                  </header>
                  <dl className="cab-set-sys">
                    <div className="cab-set-item">
                      <dt>ID ученика</dt>
                      <dd className="cab-set-mono">{studentId}</dd>
                    </div>
                    <div className="cab-set-item">
                      <dt>Дата регистрации</dt>
                      <dd>{formatDate(data.createdAt)}</dd>
                    </div>
                  </dl>
                </section>

                {/* выход — отдельный блок */}
                <section className="cab-panel cab-set-exit">
                  <div className="cab-set-exit-text">
                    <h3>Сессия</h3>
                    <p>Выйти из аккаунта на этом устройстве?</p>
                  </div>
                  <button type="button" className="cab-btn cab-btn--danger" onClick={handleSignOut} disabled={signingOut}>
                    {signingOut ? 'Выходим…' : 'Выйти из аккаунта'}
                  </button>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>

      <aside className={`cab-aside${asideOpen ? ' is-open' : ''}`}>
            <section className="cab-panel cab-profile">
              <header className="cab-panel-head cab-profile-head">
                <h3>Профиль</h3>
              </header>
              <div className="cab-profile-row">
                <span className="cab-avatar-lg">{initials(displayName)}</span>
                <div className="cab-profile-id">
                  <strong>{displayName}</strong>
                  <span className="cab-profile-role">Ученик</span>
                  <p className="cab-profile-meta">
                    {profileSaved.klass ? `${profileSaved.klass} класс` : '—'}
                    <span className="cab-profile-meta-sep" aria-hidden="true"> · </span>
                    {profileScoreLabel}
                  </p>
                </div>
              </div>
            </section>

            {achievementViews.length > 0 && (
              <section className="cab-panel cab-achieve-panel">
                <header className="cab-panel-head">
                  <h3>Достижения</h3>
                  <span className="cab-panel-hint">
                    {achievementsUnlocked} из {achievementViews.length}
                  </span>
                </header>
                <div className="cab-achieve cab-achieve--ref">
                  {achievementViews.map((item) => (
                    <div
                      key={item.title}
                      className={`cab-ach${item.unlocked ? ' is-unlocked' : ''}`}
                    >
                      <span className="cab-badge-hex">
                        <Icon d={item.unlocked ? ICONS.trophy : ICONS.lock} strokeWidth={1.4} />
                      </span>
                      <span className="cab-ach-text">
                        <strong>{item.title}</strong>
                        <em>{item.subtitle}</em>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="cab-panel cab-help">
              <header className="cab-panel-head cab-help-head">
                <h3>Поддержка</h3>
              </header>
              <div className="cab-help-inner">
                <Icon d={ICONS.support} className="cab-help-ico" strokeWidth={1.15} />
                <div className="cab-help-text">
                  <p className="cab-help-lead">
                    <span className="cab-help-q">Нужна помощь?</span> Мы рядом!
                  </p>
                  <a className="cab-help-link" href={tgBotUrl('support')} target="_blank" rel="noopener noreferrer">
                    Написать в поддержку <Icon d={ICONS.chevron} strokeWidth={1.5} />
                  </a>
                </div>
              </div>
            </section>

            <div className="cab-aside-quote" aria-hidden="true">
              <span className="cab-aside-quote-mark">&ldquo;</span>
              <div className="cab-aside-quote-body">
                <p className="cab-aside-quote-text">{data.dailyQuote.text}</p>
                <span className="cab-aside-quote-rule" />
                <span className="cab-aside-quote-brand">{data.dailyQuote.author}</span>
              </div>
            </div>
      </aside>

      <EnrollConfirmModal
        open={enrollOpen}
        courseTitle={sanityText(courseName)}
        enrolling={enrolling}
        error={enrollError}
        onConfirm={confirmEnroll}
        onCancel={() => { setEnrollOpen(false); setEnrollError(null); }}
      />
      <HomeworkReviewModal stop={hwReviewStop} onClose={() => setHwReviewStop(null)} />
      <PaymentResultModal
        result={paymentResult}
        onClose={closePaymentResult}
        onRetry={() => {
          closePaymentResult();
          router.push(checkoutHref());
        }}
        onGoCourse={() => {
          setSection('course');
          closePaymentResult();
        }}
      />
    </div>
  );
}
