'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CabinetCourseProgress, CabinetData, CabinetCourseCatalog, CabinetCourseModulePreview, CabinetCourseStop, CourseCabinetState } from '@/lib/cabinet';
import { getCourseCabinetState, hadAccess, hasActiveAccess, mapContentToCourseModules, mapContentToStructureStops } from '@/lib/cabinet';
import { priceForTeacher } from '@/lib/studio/cabinetSettings';
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

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const SANITY_PLACEHOLDER = 'ВВЕДИТЕ ТЕКСТ';

function sanityText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : SANITY_PLACEHOLDER;
}

function sanityList(value: string | null | undefined): string[] {
  const items = value?.split(/\n+/).map((s) => s.trim()).filter(Boolean) ?? [];
  return items.length ? items : [SANITY_PLACEHOLDER];
}

/* Дата следующего занятия из дд.мм.гггг → «24 / Сентября / вторник». */
function dateParts(date: string): { day: string; month: string; weekday: string } {
  const [, d, m] = date.match(/^(\d{2})\.(\d{2})\./) ?? [];
  const parsed = new Date(Number(date.slice(6, 10)), Number(m) - 1, Number(d));
  return {
    day: d ?? '—',
    month: m ? MONTHS_GEN[Number(m) - 1] : '—',
    weekday: Number.isNaN(parsed.getTime()) ? '—' : WEEKDAYS[parsed.getDay()],
  };
}

/* ---------------------------- Страница расписания ------------------------- */
/* Только реальные занятия: scheduled_lessons (ind/group) и course_lesson_sessions. */
type SchedKind = 'course' | 'individual' | 'group';
type SchedLesson = {
  id: string;
  date: Date;
  time: string;
  duration: number;
  title: string;
  kind: SchedKind;
  teacher: string;
};

const SCHED_GROUP_TEACHER = 'Анна Сергеевна';

const DAY_HEADERS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const MONTHS_NOM = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function minutesOf(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

const SCHED_KIND_LABEL: Record<SchedKind, string> = {
  course: 'Курс',
  individual: 'Индивидуальное',
  group: 'Групповое',
};


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

/* Доступные варианты пополнения пакетов (fallback, если Sanity недоступен). */
type TeacherId = string;

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Ссылка на экран «Пакеты» с опциональным фокусом на продукте. */
function packagesHref(product?: 'course' | 'individual' | 'group'): string {
  const q = new URLSearchParams({ section: 'payments' });
  if (product) q.set('product', product);
  return `/cabinet?${q}`;
}

function checkoutHref(
  product: 'course' | 'individual' | 'group',
  options?: { package?: number; teacher?: string },
): string {
  const q = new URLSearchParams({ product });
  if (options?.package != null) q.set('package', String(options.package));
  if (options?.teacher) q.set('teacher', options.teacher);
  return `/cabinet/checkout?${q}`;
}

/** Количество занятий из названия пакета («4 занятия» → 4). */
function lessonCount(name: string): number | null {
  const m = /\d+/.exec(name);
  return m ? Number(m[0]) : null;
}

/** Цена в BYN без лишних нулей: 22.5 → «22,5», 25 → «25». */
function formatByn(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')).replace('.', ',');
}

function applyCourseProgress(stops: CourseStop[], progress: CabinetCourseProgress[]): CourseStop[] {
  if (progress.length === 0) return stops;
  const map = new Map(progress.map((p) => [p.lessonIndex, p.status]));
  return stops.map((s) => ({ ...s, status: map.get(s.id - 1) ?? 'locked' }));
}

function parseLessonDate(date: string, time: string): Date {
  const [d, m, y] = date.split('.').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const NAV_GROUPS = [
  {
    label: 'Обучение',
    items: [
      { id: 'course', label: 'Курс', icon: 'course' },
      { id: 'lessons', label: 'Занятия', icon: 'individual' },
      { id: 'schedule', label: 'Расписание', icon: 'schedule' },
      { id: 'payments', label: 'Оплаты', icon: 'payments' },
    ],
  },
  {
    label: 'Аккаунт',
    items: [{ id: 'settings', label: 'Настройки', icon: 'settings' }],
  },
] as const;

type SectionId = (typeof NAV_GROUPS)[number]['items'][number]['id'];

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
  lock: 'M6 11h12v10H6V11z M9 11V8a3 3 0 0 1 6 0v3',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0V4z M8 5H4.5a3 3 0 0 0 3.5 4 M16 5h3.5a3 3 0 0 1-3.5 4 M12 14v4 M8 21h8 M10 18h4',
  play: 'M9 6.5v11l9-5.5-9-5.5z',
  file: 'M6 2h9l5 5v15H6V2z M14 2v6h6',
  download: 'M12 3v11 M7 10l5 5 5-5 M4 20h16',
  chevron: 'm9 5 7 7-7 7',
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
  spark: 'M12 2l1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2z',
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

  if (stops.length === 0) {
    return (
      <div className="cab-roadmap-frame">
        <ComingSoon text="Карта курса появится после загрузки программы." />
      </div>
    );
  }

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
    const raf = requestAnimationFrame(syncThumb);
    window.addEventListener('resize', syncThumb);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', syncThumb);
    };
  }, [syncThumb]);

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
  }, [selected]);

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

  const status: HomeworkProgressStatus = stop.homeworkStatus ?? 'pending';
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

const COURSE_TEACHER = 'Кристина Денисовна';

/* Переключатель курсов — появляется, когда курсов больше одного. */
function CourseSwitcher({
  courses,
  activeId,
  onSelect,
}: {
  courses: { id: number; title: string }[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  if (courses.length < 2) return null;
  return (
    <div className="cab-course-switch" role="tablist" aria-label="Курс">
      {courses.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={c.id === activeId}
          className={`cab-course-switch-btn${c.id === activeId ? ' is-active' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          <Icon d={ICONS.course} className="cab-course-switch-ico" />
          {c.title}
        </button>
      ))}
    </div>
  );
}

/* Preview курса для пользователя без enrollment (состояние №1). */
function CoursePreviewPanel({
  catalog,
  coverUrl,
  onEnrollClick,
}: {
  catalog: CabinetCourseCatalog | null;
  coverUrl: string | null;
  onEnrollClick: () => void;
}) {
  const [openModule, setOpenModule] = useState<number | null>(null);
  const title = catalog?.title ?? null;
  const headline = catalog?.cabinetEyebrow ?? null;
  const description = catalog?.description ?? null;
  const modules = catalog?.modulePreviews?.length ? catalog.modulePreviews : [];
  const totalLessons = catalog?.totalLessons || modules.reduce((sum, m) => sum + m.count, 0);
  const teacherName = catalog?.curatorName ?? null;
  const coverImage = catalog?.coverImageUrl ?? coverUrl ?? null;
  const courseItems = sanityList(catalog?.previewAfterEnrollment ?? null);
  const audienceItems = sanityList(catalog?.previewAudience ?? null);

  const facts: { icon: string; value: string; label: string }[] = [
    { icon: ICONS.schedule, value: String(totalLessons || '—'), label: 'занятия' },
    { icon: ICONS.course, value: String(modules.length || '—'), label: 'модулей' },
    { icon: ICONS.screen, value: sanityText(catalog?.deliveryFormat), label: 'формат' },
    { icon: ICONS.users, value: sanityText(teacherName), label: 'преподаватель' },
  ];

  return (
    <div className="cab-cpv">
      <div className="cab-cpv-top">
        <div
          className={`cab-cpv-hero${coverImage ? ' cab-cpv-hero--cover' : ' cab-panel'}`}
          style={coverImage ? ({ ['--cab-cpv-cover']: `url("${coverImage}")` } as CSSProperties) : undefined}
        >
          <section className="cab-cpv-intro">
            <span className="cab-k">{sanityText(title)}</span>
            <h2>{sanityText(headline)}</h2>
            <p>{sanityText(description)}</p>
            <button type="button" className="cab-btn cab-btn--join cab-cpv-cta" onClick={onEnrollClick}>
              Посмотреть карту курса <Icon d={ICONS.chevron} />
            </button>
          </section>
        </div>

        <ul className="cab-panel cab-cpv-facts">
          {facts.map((f) => (
            <li key={f.label}>
              <Icon d={f.icon} />
              <span>
                <b>{f.value}</b>
                <em>{f.label}</em>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="cab-cpv-bottom">
        <div className="cab-cpv-duo">
          <section className="cab-panel cab-cpv-card">
            <header className="cab-cpv-card-head">
              <Icon d={ICONS.shield} />
              <h3>Что будет на курсе</h3>
            </header>
            <ul className="cab-cpv-list">
              {courseItems.map((item) => (
                <li key={item}>
                  <Icon d={ICONS.check} />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="cab-panel cab-cpv-card">
            <header className="cab-cpv-card-head">
              <Icon d={ICONS.users} />
              <h3>Кому подойдёт</h3>
            </header>
            <ul className="cab-cpv-list">
              {audienceItems.map((item) => (
                <li key={item}>
                  <Icon d={ICONS.check} />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="cab-panel cab-cpv-card cab-cpv-program">
          <header className="cab-cpv-card-head">
            <Icon d={ICONS.course} />
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
                      <span className="cab-cpv-program-num" style={{ borderColor: m.color, color: m.color }}>
                        {String(mi + 1).padStart(2, '0')}
                      </span>
                      <span className="cab-cpv-program-title">{m.name}</span>
                      <span className="cab-cpv-program-count">{m.count} {pluralLessons(m.count)}</span>
                      <Icon d={ICONS.chevron} className="cab-cpv-program-chev" />
                    </button>
                    {isOpen && m.lessons.length > 0 && (
                      <ul className="cab-cpv-program-lessons">
                        {m.lessons.map((lesson, li) => (
                          <li key={`${lesson.title}-${li}`}>
                            <span className="cab-cpv-program-lesson-num">{String(li + 1).padStart(2, '0')}</span>
                            <span className="cab-cpv-program-lesson-title">{lesson.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="cab-note">{SANITY_PLACEHOLDER}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* Пустое расписание: карточка справа от календаря. */
function SchedEmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="cab-sched-empty-v2">
      <span className="cab-sched-empty-v2-art" aria-hidden="true">
        <Icon d={ICONS.schedule} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <a className="cab-btn cab-btn--line cab-sched-empty-v2-btn" href={packagesHref()}>
        <Icon d={ICONS.cart} /> Перейти к оплате <Icon d={ICONS.chevron} />
      </a>
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

/* Панель «не куплено / не оплачено»: замок, текст, CTA на покупку. */
function CabLocked({ title, text, note, cta }: { title: string; text: string; note?: string; cta: { label: string; href: string } }) {
  return (
    <section className="cab-panel cab-locked">
      <span className="cab-locked-ico" aria-hidden="true">
        <Icon d={ICONS.lock} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {note && <span className="cab-locked-note">{note}</span>}
      <a className="cab-btn cab-btn--join cab-locked-cta" href={cta.href}>
        {cta.label} <Icon d={ICONS.chevron} />
      </a>
    </section>
  );
}

export default function CabinetShell({
  data,
  initialSection,
  initialProduct,
}: {
  data: CabinetData;
  initialSection?: SectionId;
  initialProduct?: 'course' | 'individual' | 'group';
}) {
  const router = useRouter();
  const [section, setSection] = useState<SectionId>(initialSection ?? 'course');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [hwReviewStop, setHwReviewStop] = useState<CabinetCourseStop | null>(null);
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
  const courseModules =
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
        : [];
  const cabinetPricing = data.cabinetPricing;
  const cabinetTeachers = cabinetPricing.teachers;
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
  const courseStops =
    courseStopsFromDb.length > 0
      ? courseStopsFromDb
      : courseStopsFromSanity.length > 0
        ? applyCourseProgress(courseStopsFromSanity, data.courseProgress)
        : [];
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

  const [stopId, setStopId] = useState<number>(
    () => courseStops.find((s) => s.status === 'now')?.id ?? courseStops[0]?.id ?? 0,
  );
  const [courseTab, setCourseTab] = useState<CourseTabId>('program');
  const [activeCourseId, setActiveCourseId] = useState<number | null>(
    () => data.courseCatalog?.id ?? data.enrollment?.courseId ?? null,
  );
  const [indLessonId, setIndLessonId] = useState<string>(() => data.lessons[0]?.id ?? '');
  const [indTab, setIndTab] = useState<'upcoming' | 'done'>('upcoming');
  const [indListExpanded, setIndListExpanded] = useState(false);
  const [indListPage, setIndListPage] = useState(0);
  const [indKind, setIndKind] = useState<'individual' | 'group'>('individual');
  const [schedFilter, setSchedFilter] = useState<'all' | SchedKind>('all');
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [monthSelected, setMonthSelected] = useState<string | null>(null);
  const [shopChoice, setShopChoice] = useState<{ individual: number; group: number }>({ individual: 0, group: 0 });
  const [shopTeacher, setShopTeacher] = useState<TeacherId>(
    () => data.cabinetPricing.teachers[0]?.teacherId ?? 'kristina',
  );
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

  useEffect(() => {
    if (!cabinetTeachers.some((t) => t.teacherId === shopTeacher)) {
      setShopTeacher(cabinetTeachers[0]?.teacherId ?? 'kristina');
    }
  }, [cabinetTeachers, shopTeacher]);

  const displayName = profileSaved.name || data.studentName || 'Ученик';
  const days = daysInSystem(data.createdAt);
  const teacher = data.mentors.find((m) => m.kind === 'teacher') ?? null;
  const teacherName = teacher?.name ?? 'Кристина Денисовна';
  const courseState: CourseCabinetState = getCourseCabinetState(data);
  const courseName = data.courseCatalog?.title ?? data.courseContent?.title ?? null;
  const courseHeadline = data.courseCatalog?.cabinetEyebrow ?? data.courseContent?.cabinetEyebrow ?? null;
  const courseDescription = data.courseCatalog?.description ?? data.courseContent?.description ?? null;
  const courseTeacherName = data.courseCatalog?.curatorName ?? data.courseContent?.curatorName ?? null;
  const totalCourseLessons =
    data.courseCatalog?.totalLessons ??
    (data.courseContent ? data.courseModules.reduce((sum, m) => sum + m.count, 0) : courseStops.length);
  const courseDelivery = data.courseCatalog?.deliveryFormat ?? data.courseContent?.deliveryFormat ?? null;
  const homeworkIntro = data.courseCatalog?.homeworkIntro ?? data.courseContent?.homeworkIntro ?? null;
  const courseCoverUrl =
    data.courseCatalog?.coverImageUrl ??
    data.courseCatalog?.previewImageUrl ??
    data.courseContent?.coverImageUrl ??
    data.courseContent?.previewImageUrl ??
    null;
  /* Задел под несколько курсов: список для переключателя (скрыт, пока курс один). */
  const courseChoices = useMemo(
    () =>
      (data.courseCatalogs?.length ? data.courseCatalogs : data.courseCatalog ? [data.courseCatalog] : []).map((c) => ({
        id: c.id,
        title: c.title,
      })),
    [data.courseCatalogs, data.courseCatalog],
  );
  const mapCourseStops = courseStops;

  const lessons = data.lessons;
  const myPackages = data.packages;
  const pkgHistory = data.payments;

  const emptyStopModule = { name: '—', color: '#ccc', count: 0, about: '' };
  const stop = courseStops.find((s) => s.id === stopId) ?? courseStops[0] ?? null;
  const stopModule = stop
    ? (courseModules[stop.module] ?? courseModules[0] ?? emptyStopModule)
    : emptyStopModule;
  const selectedCabinetStop = data.courseStops.find((s) => s.id === stopId) ?? data.courseStops[0];
  const trialStopId = courseStops.find((s) => s.status !== 'locked')?.id ?? courseStops[0]?.id ?? 1;
  const kindLessons = lessons.filter((l) => l.kind === indKind);
  const indLesson = kindLessons.find((l) => l.id === indLessonId) ?? kindLessons[0];
  const IND_LIST_PAGE_SIZE = 4;
  const filteredIndLessons = kindLessons.filter((l) => l.status === indTab);
  const indListPages = Math.max(1, Math.ceil(filteredIndLessons.length / IND_LIST_PAGE_SIZE));
  const visibleIndLessons = indListExpanded
    ? filteredIndLessons
    : filteredIndLessons.slice(indListPage * IND_LIST_PAGE_SIZE, (indListPage + 1) * IND_LIST_PAGE_SIZE);

  const hasCourse = courseState === 'full';
  const hasIndividual = hasActiveAccess(data, 'individual');
  const hasGroup = hasActiveAccess(data, 'group');
  const hadIndividual = hadAccess(data, 'individual');
  const hadGroup = hadAccess(data, 'group');
  const hadCurrentIndKind = indKind === 'individual' ? hadIndividual : hadGroup;
  const hasCurrentIndKind = indKind === 'individual' ? hasIndividual : hasGroup;
  const nextLesson = hadCurrentIndKind ? (kindLessons.find((l) => l.status === 'upcoming') ?? null) : null;
  const nextDate = nextLesson ? dateParts(nextLesson.date) : null;
  const nextLessonNeedsPay = !!nextLesson && (!nextLesson.paid || !hasCurrentIndKind);
  const packsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (initialProduct === 'individual' || initialProduct === 'group') {
      setIndKind(initialProduct);
    }
  }, [initialProduct]);

  useEffect(() => {
    if (initialSection === 'payments' && initialProduct && packsRef.current) {
      packsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [initialSection, initialProduct]);

  useEffect(() => {
    if (!hadCurrentIndKind) return;
    const done = lessons.filter((l) => l.kind === indKind && l.status === 'done');
    if (done.length && (!nextLesson || nextLessonNeedsPay)) {
      setIndTab('done');
      setIndLessonId(done[0].id);
    }
  }, [hadCurrentIndKind, indKind, nextLesson?.id, nextLessonNeedsPay]);

  function switchIndKind(kind: 'individual' | 'group') {
    setIndKind(kind);
    setIndListExpanded(false);
    setIndListPage(0);
    const first =
      lessons.find((l) => l.kind === kind && l.status === 'upcoming') ??
      lessons.find((l) => l.kind === kind);
    if (first) setIndLessonId(first.id);
  }

  /* ——— Расписание: только реальные назначенные занятия (ind/group + сессии курса) ——— */
  const now = new Date();
  const todayKey = dayKey(now);
  const schedFromDb: SchedLesson[] = lessons
    .filter((l) => l.status === 'upcoming')
    .map((l) => ({
      id: l.id,
      date: parseLessonDate(l.date, l.time),
      time: l.time,
      duration: 60,
      title: l.topic,
      kind: l.kind,
      teacher: l.kind === 'group' ? (data.group?.teacherName ?? SCHED_GROUP_TEACHER) : teacherName,
    }));
  const schedFromCourse: SchedLesson[] = [];
  for (const s of data.courseStops) {
    if (!s.sessionStartsAt || s.status === 'locked') continue;
    const d = new Date(s.sessionStartsAt);
    if (Number.isNaN(d.getTime())) continue;
    const pad = (n: number) => String(n).padStart(2, '0');
    schedFromCourse.push({
      id: `course-${s.lessonId}`,
      date: d,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      duration: 90,
      title: s.title,
      kind: 'course',
      teacher: COURSE_TEACHER,
    });
  }
  const schedLessons = [...schedFromDb, ...schedFromCourse].filter(
    (l) => schedFilter === 'all' || l.kind === schedFilter,
  );
  const schedUpcoming = schedLessons.filter((l) => l.date.getTime() >= now.getTime()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const schedNext = schedUpcoming[0] ?? null;
  const schedLabel = `${MONTHS_NOM[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  function shiftSched(dir: 1 | -1) {
    setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + dir, 1));
  }

  function goSchedToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setMonthSelected(null);
  }

  /* месячная сетка: пустые ячейки до 1-го числа + дни месяца */
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: (monthCursor.getDay() + 6) % 7 }, () => null),
    ...Array.from(
      { length: new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate() },
      (_, i) => new Date(monthCursor.getFullYear(), monthCursor.getMonth(), i + 1)
    ),
  ];
  const monthSelectedDate = monthSelected ? new Date(monthSelected) : null;
  const monthDayLessons = monthSelectedDate
    ? schedLessons.filter((l) => dayKey(l.date) === dayKey(monthSelectedDate)).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
    : [];

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
    const detail = data.courseStops.find((s) => s.id === stopId);
    if (!detail?.sanityLessonId) return;
    const endpoint = phase === 'live' ? 'watch-live' : 'watch-recording';
    await fetch(`/api/cabinet/course/lessons/${encodeURIComponent(detail.sanityLessonId)}/${endpoint}`, {
      method: 'POST',
    });
    router.refresh();
  }

  /** «Открыть занятие» — полноценная страница урока. */
  function openCourseLesson() {
    const detail = data.courseStops.find((s) => s.id === stopId);
    if (!detail) return;
    router.push(`/cabinet/lesson/${encodeURIComponent(detail.sanityLessonId ?? String(detail.id))}`);
  }

  useEffect(() => {
    const detail = data.courseStops.find((s) => s.id === stopId);
    if (!detail) return;
    router.prefetch(`/cabinet/lesson/${encodeURIComponent(detail.sanityLessonId ?? String(detail.id))}`);
  }, [data.courseStops, router, stopId]);

  async function confirmEnroll() {
    setEnrolling(true);
    setEnrollError(null);
    try {
      const res = await fetch('/api/cabinet/course/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: data.courseCatalog?.id ?? data.enrollment?.courseId }),
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
            <h1>Личный кабинет</h1>
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
            {section === 'course' && courseState === 'preview' && (
              <>
                <header className="cab-sched-head">
                  <div>
                    <h2>Курс</h2>
                    <p>Ознакомься с программой и запишись на обучение</p>
                  </div>
                  <CourseSwitcher courses={courseChoices} activeId={activeCourseId} onSelect={setActiveCourseId} />
                </header>
                <CoursePreviewPanel
                  catalog={data.courseCatalog}
                  coverUrl={courseCoverUrl}
                  onEnrollClick={() => { setEnrollError(null); setEnrollOpen(true); }}
                />
              </>
            )}

            {section === 'course' && courseState !== 'preview' && (
              <div className="cab-stack cab-course-screen">
                <section className="cab-panel cab-course-shell">
                  <div className="cab-course-hero">
                    {courseChoices.length > 1 && (
                      <CourseSwitcher courses={courseChoices} activeId={activeCourseId} onSelect={setActiveCourseId} />
                    )}
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
                          <div className="cab-course-hero-badge">
                            <Icon d={ICONS.check} />
                            <span>Вы записаны на курс</span>
                          </div>
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
                              <LivesWidget locked={!hasCourse} lives={data.lives} />
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
                      {data.courseStops.map((s) => {
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
                      {!data.courseStops.length && (
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
                        {stop.status === 'now' && hasCourse && (
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
                      <a className="cab-btn cab-btn--join" href={packagesHref('course')}>
                        <Icon d={ICONS.cart} /> Купить курс
                      </a>
                    </section>
                  )
                )}
              </div>
            )}

            {section === 'lessons' && (
              <>
                <header className="cab-sched-head cab-sched-head--lessons">
                  <div>
                    <h2>Занятия</h2>
                    <p>Индивидуальные и групповые занятия с преподавателем</p>
                  </div>
                </header>
                {(hadIndividual || hadGroup) && (
                  <div className="cab-lessons-tabs" role="tablist" aria-label="Тип занятий">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={indKind === 'individual'}
                      className={`cab-lessons-tab${indKind === 'individual' ? ' is-active' : ''}`}
                      onClick={() => switchIndKind('individual')}
                    >
                      <Icon d={ICONS.individual} className="cab-lessons-tab-ico" />
                      Индивидуальные
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={indKind === 'group'}
                      className={`cab-lessons-tab${indKind === 'group' ? ' is-active' : ''}`}
                      onClick={() => switchIndKind('group')}
                    >
                      <Icon d={ICONS.users} className="cab-lessons-tab-ico" />
                      Групповые
                    </button>
                  </div>
                )}
              </>
            )}

            {section === 'lessons' && (
              <div className={`cab-stack cab-ind-scope${indKind === 'group' ? ' kind-group' : ''}`}>
                {!hadCurrentIndKind ? (
                  <CabLocked
                    title={indKind === 'group' ? 'Групповые занятия' : 'Индивидуальные занятия'}
                    text={
                      indKind === 'group'
                        ? 'Запишись на групповое занятие — здесь появятся расписание, материалы и домашка.'
                        : 'Запишись на индивидуальное занятие — здесь появятся расписание, материалы и домашка.'
                    }
                    cta={{
                      label: indKind === 'group' ? 'Купить групповое занятие' : 'Купить индивидуальное занятие',
                      href: packagesHref(indKind),
                    }}
                  />
                ) : (
                  <>
                    {!hasCurrentIndKind ? (
                      <CabLocked
                        title="Пакет занятий закончился"
                        text={
                          indKind === 'group'
                            ? 'Пополни групповой пакет, чтобы записаться на следующее занятие.'
                            : 'Пополни индивидуальный пакет, чтобы записаться на следующее занятие.'
                        }
                        cta={{
                          label: 'Пополнить пакет',
                          href: packagesHref(indKind),
                        }}
                      />
                    ) : !nextLesson ? (
                      <section className="cab-panel cab-lnx cab-lnx--wait">
                        <div className="cab-lnx-top">
                          <div className="cab-lnx-media">
                            <span className="cab-lnx-tag">Следующее занятие</span>
                            <span className="cab-lnx-media-title">
                              <b>{indKind === 'group' ? 'Групповое занятие' : 'Индивидуальное занятие'}</b>
                              <em>Ожидает назначения</em>
                            </span>
                          </div>
                          <div className="cab-lnx-info">
                            <div className="cab-lnx-info-head">
                              <span className="cab-lnx-badge is-ok">Оплачено</span>
                            </div>
                            <h3 className="cab-lnx-title">Занятие появится после назначения</h3>
                            <p className="cab-note">
                              {indKind === 'group'
                                ? 'Наставник назначит групповое занятие — оно сразу появится здесь и в расписании.'
                                : 'Наставник назначит индивидуальное занятие — оно сразу появится здесь и в расписании.'}
                            </p>
                            <div className="cab-lnx-meta">
                              <div>
                                <span className="cab-k">Наставник</span>
                                <span className="cab-ind-teacher">
                                  <i>{initials(teacherName)}</i>
                                  {teacherName}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="cab-lnx-foot">
                          <div className="cab-lnx-status">
                            <span className="cab-lnx-status-text">
                              <Icon d={ICONS.spark} />
                              Ожидаем назначения
                            </span>
                            <span className="cab-lnx-bar" aria-hidden="true">
                              <i style={{ width: '20%' }} />
                            </span>
                          </div>
                          <a
                            className="cab-btn cab-btn--join cab-lnx-cta"
                            href={tgBotUrl('mentor')}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Связаться с наставником <Icon d={ICONS.chevron} />
                          </a>
                        </div>
                      </section>
                    ) : (
                      <section className="cab-panel cab-lnx">
                        <div className="cab-lnx-top">
                          <div className="cab-lnx-media">
                            <span className="cab-lnx-tag">Следующее занятие</span>
                            <span className="cab-lnx-media-title">
                              <b>{indKind === 'group' ? 'Групповое занятие' : 'Индивидуальное занятие'}</b>
                              <em>{nextLesson.topic}</em>
                            </span>
                          </div>

                          <div className="cab-lnx-info">
                            <div className="cab-lnx-info-head">
                              <span className="cab-lnx-badge">
                                {indKind === 'group' ? 'Групповое' : 'Индивидуальное'} занятие
                              </span>
                              {nextLessonNeedsPay ? (
                                <span className="cab-lnx-badge is-warn">Не оплачено</span>
                              ) : (
                                <span className="cab-lnx-badge is-ok">Оплачено</span>
                              )}
                            </div>
                            <h3 className="cab-lnx-title">{nextLesson.topic}</h3>
                            <div className="cab-lnx-row">
                              <div className="cab-lnx-pills">
                                <div className="cab-lnx-pill">
                                  <Icon d={ICONS.schedule} />
                                  <span>
                                    <b>
                                      {nextDate?.day} {nextDate?.month}
                                    </b>
                                    <em>{nextDate?.weekday}</em>
                                  </span>
                                </div>
                                <div className="cab-lnx-pill">
                                  <Icon d={ICONS.clock} />
                                  <span>
                                    <b>{nextLesson.time}</b>
                                    <em>60 минут</em>
                                  </span>
                                </div>
                              </div>
                              <div className="cab-lnx-meta">
                                <div>
                                  <span className="cab-k">Тема занятия</span>
                                  <strong>{nextLesson.topic}</strong>
                                </div>
                                <div>
                                  <span className="cab-k">Преподаватель</span>
                                  <span className="cab-ind-teacher">
                                    <i>
                                      {initials(
                                        indKind === 'group'
                                          ? (data.group?.teacherName ?? teacherName)
                                          : teacherName,
                                      )}
                                    </i>
                                    {indKind === 'group' ? (data.group?.teacherName ?? teacherName) : teacherName}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="cab-lnx-foot">
                          <div className="cab-lnx-status">
                            <span className="cab-lnx-status-text">
                              <Icon d={ICONS.spark} />
                              {nextLessonNeedsPay ? 'Ожидает оплаты' : 'Готово к прохождению'}
                            </span>
                            <span className="cab-lnx-bar" aria-hidden="true">
                              <i style={{ width: nextLessonNeedsPay ? '35%' : '70%' }} />
                            </span>
                          </div>
                          {nextLessonNeedsPay ? (
                            <a className="cab-btn cab-btn--join cab-lnx-cta" href={packagesHref(indKind)}>
                              Оплатить занятие <Icon d={ICONS.chevron} />
                            </a>
                          ) : (
                            <div className="cab-lnx-cta-row">
                              {nextLesson.meetUrl ? (
                                <a
                                  className="cab-btn cab-btn--join cab-lnx-cta"
                                  href={nextLesson.meetUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Icon d={ICONS.play} /> Подключиться <Icon d={ICONS.chevron} />
                                </a>
                              ) : (
                                <button type="button" className="cab-btn cab-btn--join cab-lnx-cta" disabled>
                                  <Icon d={ICONS.play} /> Подключиться <Icon d={ICONS.chevron} />
                                </button>
                              )}
                              {nextLesson.status === 'upcoming' && (
                                <a
                                  className="cab-btn cab-btn--line cab-lnx-cta"
                                  href={tgBotUrl('mentor_hw')}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Icon d={ICONS.homework} /> Сдать домашку
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    )}

                    <div className="cab-ind-grid">
                      <section className="cab-panel cab-my-lessons">
                        <header className="cab-panel-head cab-my-lessons-head">
                          <div>
                            <h3>Мои занятия</h3>
                            <span className="cab-panel-hint">выбери, чтобы увидеть материалы и домашку</span>
                          </div>
                          <button
                            type="button"
                            className="cab-my-lessons-cal"
                            title="Открыть расписание"
                            onClick={() => setSection('schedule')}
                          >
                            <Icon d={ICONS.schedule} />
                          </button>
                        </header>
                        <div className="cab-ind-tabs" role="tablist" aria-label="Фильтр занятий">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={indTab === 'upcoming'}
                            className={`cab-ind-tab${indTab === 'upcoming' ? ' is-active' : ''}`}
                            onClick={() => {
                              setIndTab('upcoming');
                              setIndListPage(0);
                              setIndListExpanded(false);
                              const first = kindLessons.find((l) => l.status === 'upcoming');
                              if (first) setIndLessonId(first.id);
                            }}
                          >
                            Предстоящие <b>{kindLessons.filter((l) => l.status === 'upcoming').length}</b>
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={indTab === 'done'}
                            className={`cab-ind-tab${indTab === 'done' ? ' is-active' : ''}`}
                            onClick={() => {
                              setIndTab('done');
                              setIndListPage(0);
                              setIndListExpanded(false);
                              const first = kindLessons.find((l) => l.status === 'done');
                              if (first) setIndLessonId(first.id);
                            }}
                          >
                            Завершённые <b>{kindLessons.filter((l) => l.status === 'done').length}</b>
                          </button>
                        </div>
                        <div className={`cab-ind-list${indListExpanded ? ' is-expanded' : ''}`}>
                          {visibleIndLessons.map((l) => {
                            const monthIdx = Number(l.date.slice(3, 5)) - 1;
                            return (
                              <button
                                key={l.id}
                                type="button"
                                className={`cab-ind-row${indLessonId === l.id ? ' is-selected' : ''}`}
                                onClick={() => setIndLessonId(l.id)}
                              >
                                <span className="cab-ind-row-date" aria-hidden="true">
                                  <b>{l.date.slice(0, 2)}</b>
                                  <em>{MONTHS_SHORT[monthIdx] ?? l.date.slice(3, 5)}</em>
                                </span>
                                <span className="cab-ind-cell-main">
                                  <strong>{l.time}</strong>
                                  <span>{l.topic}</span>
                                </span>
                                <span
                                  className={`cab-ind-status is-${l.status === 'upcoming' ? 'upcoming' : 'done'}`}
                                >
                                  {l.status === 'upcoming'
                                    ? l.paid === false
                                      ? 'Ожидает оплаты'
                                      : 'Предстоит'
                                    : 'Завершено'}
                                </span>
                                <Icon d={ICONS.chevron} className="cab-ind-chev" />
                              </button>
                            );
                          })}
                        </div>
                        {filteredIndLessons.length > 0 && (
                          <div className="cab-my-lessons-foot">
                            <button
                              type="button"
                              className="cab-my-lessons-more"
                              onClick={() => {
                                setIndListExpanded((v) => !v);
                                setIndListPage(0);
                              }}
                            >
                              {indListExpanded ? 'Свернуть список' : 'Показать все занятия'}
                              <Icon d={ICONS.chevron} />
                            </button>
                            {!indListExpanded && indListPages > 1 && (
                              <div className="cab-my-lessons-pager">
                                <button
                                  type="button"
                                  className="cab-my-lessons-pager-btn"
                                  disabled={indListPage <= 0}
                                  aria-label="Предыдущая страница"
                                  onClick={() => setIndListPage((p) => Math.max(0, p - 1))}
                                >
                                  <Icon d={ICONS.back} />
                                </button>
                                <span>
                                  {indListPage + 1} / {indListPages}
                                </span>
                                <button
                                  type="button"
                                  className="cab-my-lessons-pager-btn"
                                  disabled={indListPage >= indListPages - 1}
                                  aria-label="Следующая страница"
                                  onClick={() => setIndListPage((p) => Math.min(indListPages - 1, p + 1))}
                                >
                                  <Icon d={ICONS.chevron} />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </section>

                      {indLesson ? (
                      <div key={indLesson.id} className="cab-ind-side cab-anim-pop">
                        <section className="cab-panel">
                          <header className="cab-panel-head">
                            <h3>Материалы с уроков</h3>
                          </header>
                          {indLesson.status === 'done' && indLesson.materials.length > 0 ? (
                            <div className="cab-files cab-files--plain">
                              {indLesson.materials.map((f) => (
                                <div key={f.id} className="cab-file">
                                  <Icon d={ICONS.file} className="cab-file-ico" />
                                  <span className="cab-file-name">{f.name}</span>
                                  <span className="cab-file-size">{f.size}</span>
                                  <a
                                    href={f.downloadUrl}
                                    className="cab-file-dl"
                                    aria-label={`Скачать ${f.name}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Icon d={ICONS.download} />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="cab-note cab-note--materials-wait">
                              Материалы для изучения занятия появятся после проведения вебинара.
                            </p>
                          )}
                        </section>

                        <section className="cab-panel">
                          <header className="cab-panel-head">
                            <h3>Домашнее задание</h3>
                          </header>
                          {/* сдать домашку можно только за ближайшее занятие — кнопка в блоке выше */}
                          {indLesson.status === 'upcoming' ? (
                            <div className="cab-hw">
                              <p className="cab-note">
                                Домашку по ближайшему занятию можно сдать через Telegram-бот.
                              </p>
                              <a
                                className="cab-btn cab-btn--line"
                                href={tgBotUrl('mentor_hw')}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Icon d={ICONS.homework} /> Сдать домашку в Telegram
                              </a>
                            </div>
                          ) : indLesson.homework ? (
                            <div className="cab-hw">
                              <div className="cab-file cab-file--big">
                                <Icon d={ICONS.file} className="cab-file-ico" />
                                <span className="cab-file-name">{indLesson.homework.name}</span>
                                <span className="cab-file-size">{indLesson.homework.size}</span>
                              </div>
                              <a
                                href={indLesson.homework.downloadUrl}
                                className="cab-btn cab-btn--line"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Открыть файл домашки <Icon d={ICONS.download} />
                              </a>
                            </div>
                          ) : (
                            <p className="cab-note">Домашка появится здесь после занятия.</p>
                          )}
                        </section>
                      </div>
                      ) : (
                        <p className="cab-note">Занятий этого типа пока нет.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {section === 'schedule' && (
              <div className="cab-stack cab-sched-scope">
                <header className="cab-sched-head">
                  <div>
                    <h2>Расписание</h2>
                    <p>Твои предстоящие занятия</p>
                  </div>
                </header>

                {/* чипы-фильтры слева, переключатель периода — справа */}
                <div className="cab-sched-top">
                  <div className="cab-sched-filters" role="tablist" aria-label="Фильтр занятий">
                    <button type="button" role="tab" aria-selected={schedFilter === 'all'} className={`cab-sched-filter${schedFilter === 'all' ? ' is-active' : ''}`} onClick={() => setSchedFilter('all')}>
                      <Icon d={ICONS.check} className="cab-sched-filter-ico" />
                      Все
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schedFilter === 'course'}
                      className={`cab-sched-filter${schedFilter === 'course' ? ' is-active' : ''}`}
                      onClick={() => setSchedFilter('course')}
                    >
                      <Icon d={ICONS.course} className="cab-sched-filter-ico" />
                      Курс
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schedFilter === 'individual'}
                      className={`cab-sched-filter${schedFilter === 'individual' ? ' is-active' : ''}`}
                      onClick={() => setSchedFilter('individual')}
                    >
                      <Icon d={ICONS.individual} className="cab-sched-filter-ico" />
                      Индивидуальные
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schedFilter === 'group'}
                      className={`cab-sched-filter${schedFilter === 'group' ? ' is-active' : ''}`}
                      onClick={() => setSchedFilter('group')}
                    >
                      <Icon d={ICONS.users} className="cab-sched-filter-ico" />
                      Групповые
                    </button>
                  </div>
                  <div className="cab-sched-nav">
                    <button type="button" className="cab-sched-arrow" onClick={() => shiftSched(-1)} aria-label="Назад">
                      <Icon d={ICONS.back} />
                    </button>
                    {/*suppressHydrationWarning: даты считаются на клиенте*/}
                    <strong suppressHydrationWarning>{schedLabel}</strong>
                    <button type="button" className="cab-sched-arrow" onClick={() => shiftSched(1)} aria-label="Вперёд">
                      <Icon d={ICONS.chevron} />
                    </button>
                    <button type="button" className="cab-btn cab-btn--line cab-sched-today" onClick={goSchedToday}>
                      Сегодня
                    </button>
                  </div>
                </div>

                <div className="cab-sched-layout">
                  <div className="cab-sched-main">
                    <section className="cab-panel cab-sched-cal">
                      <header className="cab-sched-calhead">
                        <h3>Календарь</h3>
                      </header>

                      <div className="cab-sched-month">
                        <div className="cab-sched-month-head" aria-hidden="true">
                          {DAY_HEADERS.map((d) => (
                            <span key={d}>{d}</span>
                          ))}
                        </div>
                        <div className="cab-sched-month-grid">
                          {monthCells.map((d, i) =>
                            d ? (
                              <button
                                key={i}
                                type="button"
                                className={`cab-sched-cell${dayKey(d) === todayKey ? ' is-today' : ''}${monthSelected === dayKey(d) ? ' is-selected' : ''}`}
                                onClick={() => setMonthSelected(monthSelected === dayKey(d) ? null : dayKey(d))}
                              >
                                {/*suppressHydrationWarning: даты считаются на клиенте*/}
                                <b suppressHydrationWarning>{d.getDate()}</b>
                                <span className="cab-sched-dots">
                                  {schedLessons
                                    .filter((l) => dayKey(l.date) === dayKey(d))
                                    .slice(0, 3)
                                    .map((l) => (
                                      <i key={l.id} className={`k-${l.kind}`} />
                                    ))}
                                </span>
                              </button>
                            ) : (
                              <span key={i} className="cab-sched-cell is-blank" />
                            )
                          )}
                        </div>
                        <div className="cab-sched-legend" aria-hidden="true">
                          <span>
                            <i className="cab-kind-dot k-course" /> Занятия курса
                          </span>
                          <span>
                            <i className="cab-kind-dot k-individual" /> Индивидуальные
                          </span>
                          <span>
                            <i className="cab-kind-dot k-group" /> Групповые
                          </span>
                        </div>
                      </div>
                    </section>

                    {monthSelectedDate ? (
                      monthDayLessons.length > 0 ? (
                        <section className="cab-panel cab-sched-day">
                          <header className="cab-panel-head">
                            <h3>
                              Занятия · {monthSelectedDate.getDate()} {MONTHS_GEN[monthSelectedDate.getMonth()]}
                            </h3>
                          </header>
                          <ul className="cab-day-lessons">
                            {monthDayLessons.map((l) => (
                              <li key={l.id}>
                                <em>{l.time}</em>
                                <i className={`cab-kind-dot k-${l.kind}`} aria-hidden="true" />
                                <span className="cab-day-title">
                                  <strong>{l.title}</strong>
                                  <small>
                                    {l.teacher} · {l.duration} минут
                                  </small>
                                </span>
                                <span className={`cab-schedule-kind k-${l.kind}`}>{SCHED_KIND_LABEL[l.kind]}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : (
                        <section className="cab-panel cab-sched-day cab-sched-day--empty">
                          <span className="cab-sched-day-empty-ico" aria-hidden="true">
                            <Icon d={ICONS.schedule} />
                          </span>
                          <h4>В этот день занятий нет</h4>
                          <p className="cab-note">Выбери другой день в календаре или запишись на новое занятие.</p>
                        </section>
                      )
                    ) : schedNext ? (
                      <section className="cab-panel cab-next-card is-now">
                        <header className="cab-panel-head">
                          <h3>Ближайшее занятие</h3>
                        </header>
                        <div className="cab-next-card-body">
                          <span className="cab-next-card-date" aria-hidden="true">
                            {/*suppressHydrationWarning: даты считаются на клиенте*/}
                            <b suppressHydrationWarning>{schedNext.date.getDate()}</b>
                            <em>{MONTHS_SHORT[schedNext.date.getMonth()]}</em>
                          </span>
                          <span className="cab-next-card-main">
                            <strong>{schedNext.title}</strong>
                            {/*suppressHydrationWarning: даты считаются на клиенте*/}
                            <em suppressHydrationWarning>
                              {WEEKDAYS[schedNext.date.getDay()]}, {schedNext.time} · {schedNext.duration} минут ·{' '}
                              <span className={`cab-next-card-kind k-${schedNext.kind}`}>{SCHED_KIND_LABEL[schedNext.kind]}</span>
                            </em>
                          </span>
                        </div>
                      </section>
                    ) : null}
                  </div>

                  <section className="cab-panel cab-sched-detail">
                    {!schedNext ? (
                      <SchedEmptyPanel
                        title="Пока что занятий нет"
                        text="Запишись на занятие или выбери день в календаре, чтобы увидеть расписание."
                      />
                    ) : (
                      <div className="cab-sched-near">
                        <h3 className="cab-near-head">Ближайшие занятия</h3>
                        {schedUpcoming.slice(0, 4).map((l) => (
                          <article
                            key={l.id}
                            className={`cab-near-tile${l.id === schedNext.id ? ' is-now' : ''}`}
                          >
                            <span className="cab-near-date" aria-hidden="true">
                              <b>{l.date.getDate()}</b>
                              <em>{MONTHS_SHORT[l.date.getMonth()]}</em>
                            </span>
                            <span className="cab-near-time">
                              <strong>{l.time}</strong>
                              <em>{l.duration} мин</em>
                            </span>
                            <span className="cab-near-main">
                              <strong>{l.title}</strong>
                              <em>{l.teacher}</em>
                            </span>
                            <span className={`cab-schedule-kind k-${l.kind}`}>{SCHED_KIND_LABEL[l.kind]}</span>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {section === 'payments' && (
              <div className="cab-stack">
                <header className="cab-sched-head">
                  <div>
                    <h2>Пополнение занятий</h2>
                    <p>Доступ к курсу, пакеты занятий и история покупок</p>
                  </div>
                </header>

                {/* 01 — доступные пакеты: курс отдельно, занятия — с выбором преподавателя */}
                <section ref={packsRef} className="cab-panel cab-pack-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">01 · Доступные пакеты</span>
                  </header>

                  <article className="cab-pack-course">
                    <span className="cab-pack-course-ico" aria-hidden="true">
                      <Icon d={ICONS.course} />
                    </span>
                    <div className="cab-pack-course-main">
                      <div className="cab-pack-course-copy">
                        <strong>{cabinetPricing.course.label}</strong>
                        {cabinetPricing.course.offer.description && (
                          <em>{cabinetPricing.course.offer.description}</em>
                        )}
                      </div>
                      <ul className="cab-pack-course-chips">
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
                    <span className="cab-pack-price">
                      {String(cabinetPricing.course.offer.priceByn)} <em>BYN</em>
                    </span>
                    <a className="cab-btn cab-btn--join" href={checkoutHref('course')}>
                      Купить курс <Icon d={ICONS.chevron} />
                    </a>
                  </article>

                  {/* занятия — с преподавателем на выбор */}
                  <div className="cab-pack-sep">
                    <h4 className="cab-pack-sep-title">Занятия с преподавателем</h4>
                    {cabinetTeachers.length > 1 && (
                      <div
                        className={`cab-pack-teacher is-count-${Math.min(Math.max(cabinetTeachers.length, 1), 4)}`}
                        role="tablist"
                        aria-label="Преподаватель"
                      >
                        {cabinetTeachers.map((teacher) => (
                          <button
                            key={teacher.teacherId}
                            type="button"
                            role="tab"
                            aria-selected={shopTeacher === teacher.teacherId}
                            className={`cab-pack-teacher-btn${shopTeacher === teacher.teacherId ? ' is-active' : ''}`}
                            onClick={() => setShopTeacher(teacher.teacherId)}
                          >
                            <Icon d={ICONS.users} className="cab-pack-teacher-ico" />
                            <span>{teacher.name}</span>
                            {shopTeacher === teacher.teacherId && (
                              <Icon d={ICONS.check} className="cab-pack-teacher-check" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="cab-pack-grid">
                    {(['individual', 'group'] as const).map((t) => {
                      const pack = cabinetPricing[t];
                      const options = pack.options;
                      const chosen = Math.min(shopChoice[t], Math.max(0, options.length - 1));
                      const option = options[chosen];
                      if (!option) return null;
                      const priceNum = (o: (typeof options)[number]) => priceForTeacher(o, shopTeacher, cabinetTeachers);
                      const priceOf = (o: (typeof options)[number]) => {
                        const price = priceNum(o);
                        return price != null ? String(price) : '—';
                      };
                      return (
                        <article key={`${t}-${shopTeacher}`} className="cab-pack-card cab-pack-flash">
                          <header className="cab-pack-card-head">
                            <strong className="cab-pack-title">{pack.label}</strong>
                            <span className="cab-pack-sub">
                              {t === 'individual'
                                ? 'Личный подход и максимальный результат'
                                : 'Эффективная подготовка в команде'}
                            </span>
                          </header>
                          <div className="cab-pack-options" role="radiogroup" aria-label="Объём пакета">
                            {options.map((o, oi) => {
                              const price = priceNum(o);
                              const count = lessonCount(o.name);
                              const per = price != null && count ? price / count : null;
                              const chip = o.savingsChip;
                              return (
                                <button
                                  key={o.name}
                                  type="button"
                                  role="radio"
                                  aria-checked={chosen === oi}
                                  className={`cab-pack-opt${chosen === oi ? ' is-active' : ''}`}
                                  onClick={() => setShopChoice({ ...shopChoice, [t]: oi })}
                                >
                                  <i className="cab-pack-opt-radio" aria-hidden="true" />
                                  <span className="cab-pack-opt-main">
                                    <b>{o.name}</b>
                                    {per != null && <em>{formatByn(per)} BYN / занятие</em>}
                                  </span>
                                  <span className="cab-pack-opt-right">
                                    <span className="cab-pack-opt-price">{priceOf(o)} BYN</span>
                                    {chip ? <span className="cab-pack-opt-save">{chip}</span> : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="cab-pack-foot">
                            <span className="cab-pack-total">
                              <span className="cab-k">Итого</span>
                              <b>
                                {priceOf(option)} <em>BYN</em>
                              </b>
                              <small>{option.name}</small>
                            </span>
                            <a
                              className="cab-btn cab-btn--join"
                              href={checkoutHref(t, { package: chosen, teacher: shopTeacher })}
                            >
                              Продолжить <Icon d={ICONS.chevron} />
                            </a>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                {/* 02 — мои пакеты: активные покупки компактно */}
                <section className="cab-panel cab-mypkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">02 · Мои пакеты</span>
                  </header>
                  {myPackages.length === 0 && (
                    <p className="cab-note cab-pkg-empty-note">Активных пакетов пока нет — выбери тариф выше.</p>
                  )}
                  <ul className="cab-mypkgs">
                    {myPackages.map((p) => {
                      const product = p.product;
                      return (
                        <li key={p.id} className={p.active ? '' : 'is-done'}>
                          <span className="cab-mypkg-info">
                            <strong>{p.title}</strong>
                            <em>{p.sub}</em>
                          </span>
                          <span className="cab-mypkg-left" title="Осталось до следующей оплаты">
                            <b>{p.remaining}</b>
                            <span>
                              / {p.total} {pluralLessons(p.total)}
                            </span>
                          </span>
                          <span className={`cab-pkg-status${p.active ? ' is-active' : ''}`}>
                            <i aria-hidden="true" />
                            {p.active ? 'Активен' : 'Завершён'}
                          </span>
                          <a className="cab-btn cab-btn--line" href={checkoutHref(product)}>
                            {p.active ? 'Пополнить' : 'Купить новый'} <Icon d={ICONS.chevron} />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* 03 — история покупок */}
                <section className="cab-panel cab-pkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">03 · История покупок</span>
                    <button type="button" className="cab-pkg-history-all" onClick={() => setPkgHistoryAll((v) => !v)}>
                      {pkgHistoryAll ? 'Свернуть' : 'Показать все'} <Icon d={ICONS.chevron} />
                    </button>
                  </header>
                  {pkgHistory.length === 0 && (
                    <p className="cab-note cab-pkg-empty-note">История покупок появится после первой оплаты.</p>
                  )}
                  <ul className="cab-pkg-history">
                    {(pkgHistoryAll ? pkgHistory : pkgHistory.slice(0, 2)).map((h) => (
                      <li key={h.id}>
                        <span className="cab-h-date">{h.date}</span>
                        <span className="cab-h-title">{h.title}</span>
                        <span className="cab-h-price">{h.price} BYN</span>
                        <span
                          className={`cab-h-status${h.status === 'pending' ? ' is-pending' : h.status === 'rejected' ? ' is-rejected' : ''}`}
                        >
                          {h.status === 'pending'
                            ? 'На рассмотрении'
                            : h.status === 'rejected'
                              ? 'Отклонено'
                              : 'Оплачено'}
                        </span>
                      </li>
                    ))}
                  </ul>
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
                <p className="cab-aside-quote-text">
                  Главное — не идеальность, <strong>а регулярность.</strong>
                </p>
                <span className="cab-aside-quote-rule" />
                <span className="cab-aside-quote-brand">District</span>
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
    </div>
  );
}
