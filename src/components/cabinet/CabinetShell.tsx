'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CabinetData, CabinetMode } from '@/lib/cabinet';

/* -------------------------------------------------------------------------- */
/* ВРЕМЕННЫЕ ДЕМО-ДАННЫЕ ДЛЯ ПРЕВЬЮ ИНТЕРФЕЙСА.                               */
/* Реальных таблиц занятий/материалов пока нет — при их появлении             */
/* заменить эти константы на данные из Supabase.                              */
/* -------------------------------------------------------------------------- */

const DEMO_PROFILE = { name: 'Иван Петров', sub: 'Ученик 10 класса', level: '10 класс', goal: '90+ баллов' };

/* Курс: 74 занятия в 7 модулях, у каждого модуля свой цвет. */
const DEMO_MODULES = [
  { name: 'Диагностика', color: '#38c6ff', count: 11, about: 'Стартовая проверка уровня: арифметика, базовые уравнения и логика. Составляем личный план курса.' },
  { name: 'Алгебра', color: '#4f7cff', count: 11, about: 'Уравнения и неравенства, преобразования выражений, типовые задачи экзамена.' },
  { name: 'Геометрия', color: '#ff9a2e', count: 11, about: 'Планиметрия: треугольники, окружности, четырёхугольники. Основные теоремы и задачи.' },
  { name: 'Теория чисел', color: '#3ddc97', count: 11, about: 'Делимость, НОД и НОК, сравнения и олимпиадные приёмы.' },
  { name: 'Тригонометрия', color: '#a78bfa', count: 10, about: 'Тригонометрический круг, тождества, уравнения и методы их решения.' },
  { name: 'Комбинаторика', color: '#ffd166', count: 10, about: 'Перестановки, размещения, сочетания, задачи на подсчёт и вероятность.' },
  { name: 'Экзамен', color: '#ff5d73', count: 10, about: 'Итоговый пробный экзамен: тайминг, стратегия и разбор ловушек.' },
];

type StopStatus = 'watched' | 'done' | 'now' | 'locked';
type StopKind = 'webinar' | 'practice' | 'milestone';
type CourseStop = { id: number; module: number; numInModule: number; status: StopStatus; kind: StopKind; title: string; date: string };

const DEMO_WATCHED_COUNT = 20; // просмотрено полностью (демо)
const DEMO_DONE_COUNT = 26; // просмотрено + пройдено (демо)

/* Демо-темы вебинаров по модулям (циклически, пока нет реальной таблицы). */
const MODULE_TOPICS = [
  ['Стартовая диагностика', 'Числа и вычисления', 'Текстовые задачи', 'Логика и прикидка'],
  ['Линейные уравнения', 'Квадратные уравнения', 'Неравенства', 'Системы уравнений'],
  ['Треугольники', 'Окружности', 'Четырёхугольники', 'Площади фигур'],
  ['Делимость чисел', 'НОД и НОК', 'Остатки и сравнения', 'Олимпиадные приёмы'],
  ['Тригонометрический круг', 'Тождества', 'Уравнения', 'Методы решения'],
  ['Перестановки', 'Сочетания', 'Подсчёт и вероятность'],
  ['Пробный экзамен', 'Разбор ловушек', 'Стратегия и тайминг'],
];

const stopDate = (index: number): string => {
  const d = new Date(2026, 1, 2 + index * 3); // демо-расписание: занятия раз в 3 дня
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DEMO_STOPS: CourseStop[] = (() => {
  const stops: CourseStop[] = [];
  let id = 1;
  DEMO_MODULES.forEach((m, mi) => {
    const topics = MODULE_TOPICS[mi] ?? ['Вебинар'];
    for (let i = 0; i < m.count; i += 1) {
      stops.push({
        id,
        module: mi,
        numInModule: i + 1,
        status: id <= DEMO_WATCHED_COUNT ? 'watched' : id <= DEMO_DONE_COUNT ? 'done' : id === DEMO_DONE_COUNT + 1 ? 'now' : 'locked',
        kind: i === m.count - 1 ? 'milestone' : (i + 1) % 4 === 0 ? 'practice' : 'webinar',
        title: topics[i % topics.length],
        date: stopDate(id - 1),
      });
      id += 1;
    }
  });
  return stops;
})();

const MODULE_RANGES = (() => {
  let start = 0;
  return DEMO_MODULES.map((m) => {
    const r = { start, end: start + m.count - 1 };
    start += m.count;
    return r;
  });
})();

const DEMO_PROGRESS = Math.round((DEMO_DONE_COUNT / DEMO_STOPS.length) * 100);
const DEMO_LIVES = { full: 2, total: 3, restore: '12:45:32' };

const DEMO_FILES = [
  { name: 'Презентация.pdf', size: '2.4 MB' },
  { name: 'Конспект.docx', size: '1.1 MB' },
  { name: 'Задачи.pdf', size: '3.7 MB' },
];

const DEMO_ACHIEVEMENTS = [
  { id: 'a1', icon: 'rocket', title: 'Первые шаги', sub: 'Пройди диагностику', unlocked: true },
  { id: 'a2', icon: 'target', title: 'Алгебра старт', sub: 'Посети 1 вебинар', unlocked: true },
  { id: 'a3', icon: 'lock', title: 'Геометр мастер', sub: 'Пройди 3 вебинара', unlocked: false },
  { id: 'a4', icon: 'lock', title: 'На пути к 100', sub: 'Набери 100 баллов', unlocked: false },
];

/* Индивидуальные занятия: предстоящие и завершённые, материалы и домашка. */
type IndivLesson = {
  id: string;
  kind: 'individual' | 'group';
  date: string;
  time: string;
  topic: string;
  status: 'upcoming' | 'done';
  materials: { name: string; size: string }[];
  homework: { name: string; size: string; state: string; tone: 'ok' | 'now' } | null;
};

const DEMO_IND_LESSONS: IndivLesson[] = [
  { id: 'u1', kind: 'individual', date: '24.09.2024', time: '18:30', topic: 'Квадратные уравнения', status: 'upcoming', materials: [], homework: null },
  { id: 'u2', kind: 'individual', date: '01.10.2024', time: '18:30', topic: 'Теория вероятностей', status: 'upcoming', materials: [], homework: null },
  { id: 'u3', kind: 'group', date: '05.10.2024', time: '17:00', topic: 'Групповой интенсив: параметры', status: 'upcoming', materials: [], homework: null },
  {
    id: 'd1', kind: 'individual', date: '20.09.2024', time: '18:30', topic: 'Дробно-рациональные выражения', status: 'done',
    materials: [{ name: 'Презентация.pdf', size: '2.1 MB' }, { name: 'Конспект.docx', size: '0.9 MB' }],
    homework: { name: 'ДЗ_Дробные выражения.pdf', size: '0.8 MB', state: 'Проверено', tone: 'ok' },
  },
  {
    id: 'd2', kind: 'individual', date: '17.09.2024', time: '18:30', topic: 'Квадратные неравенства', status: 'done',
    materials: [{ name: 'Презентация.pdf', size: '1.8 MB' }],
    homework: { name: 'ДЗ_Квадратные неравенства.pdf', size: '0.7 MB', state: 'На проверке', tone: 'now' },
  },
  {
    id: 'd3', kind: 'group', date: '13.09.2024', time: '17:00', topic: 'Групповой интенсив: планиметрия', status: 'done',
    materials: [{ name: 'Конспект.docx', size: '1.2 MB' }, { name: 'Графики.pdf', size: '2.6 MB' }],
    homework: { name: 'ДЗ_Функции.pdf', size: '0.6 MB', state: 'Проверено', tone: 'ok' },
  },
];

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

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
/* Демо-занятия вокруг текущей даты (индивидуальные + групповые).
   Курс в расписание не входит — у него своя дорожная карта. */
type SchedKind = 'individual' | 'group';
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

function schedDate(offsetDays: number, time: string): Date {
  const d = new Date();
  const [hh, mm] = time.split(':').map(Number);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function schedLesson(
  id: string,
  offsetDays: number,
  time: string,
  title: string,
  kind: SchedKind,
  teacher: string = 'Кристина Денисовна',
  duration = 60
): SchedLesson {
  return { id, date: schedDate(offsetDays, time), time, duration, title, kind, teacher };
}

const DEMO_SCHED_LESSONS: SchedLesson[] = [
  schedLesson('s1', 0, '18:30', 'Квадратные уравнения', 'individual'),
  schedLesson('s2', 1, '18:00', 'Групповой интенсив: параметры', 'group', SCHED_GROUP_TEACHER),
  schedLesson('s3', 2, '17:00', 'Дробно-рациональные выражения', 'individual'),
  schedLesson('s4', 4, '18:00', 'Теорема Виета', 'group', SCHED_GROUP_TEACHER),
  schedLesson('s5', 5, '19:00', 'Параметры', 'individual'),
  schedLesson('s6', 8, '18:00', 'Системы уравнений', 'group', SCHED_GROUP_TEACHER),
  schedLesson('s7', 9, '18:30', 'Текстовые задачи', 'individual'),
];

const DAY_HEADERS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const MONTHS_NOM = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
const SCHED_START_HOUR = 10;
const SCHED_HOURS = 11; // 10:00–21:00
const HOUR_PX = 56;

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function minutesOf(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

function endTime(time: string, duration: number): string {
  const total = minutesOf(time) + duration;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* Раскладка занятий дня по колонкам при пересечении по времени. */
function layoutColumns(items: SchedLesson[]): { lesson: SchedLesson; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  const colEnds: number[] = [];
  const placed = sorted.map((lesson) => {
    const start = minutesOf(lesson.time);
    const end = start + lesson.duration;
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    return { lesson, col };
  });
  const cols = Math.max(1, colEnds.length);
  return placed.map((p) => ({ ...p, cols }));
}

const SCHED_KIND_LABEL: Record<SchedKind, string> = {
  individual: 'Индивидуальное',
  group: 'Групповое',
};

/* ---------------------------- Страница пакетов ---------------------------- */
/* Демо-состояние пакетов. При появлении реальной таблицы занятий/пакетов
   заменить на данные из Supabase. */
type DemoPackage = { id: string; title: string; sub: string; remaining: number; total: number; active: boolean };

const DEMO_MY_PACKAGES: DemoPackage[] = [
  { id: 'p-course', title: 'Курс District', sub: 'Алгебра + Геометрия', remaining: 5, total: 8, active: true },
  { id: 'p-ind', title: 'Индивидуальные занятия', sub: 'Кристина Денисовна', remaining: 2, total: 4, active: true },
  { id: 'p-group', title: 'Групповые занятия', sub: '10 класс · Алгебра · Анна Сергеевна', remaining: 0, total: 8, active: false },
];

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
}

const DEMO_PKG_HISTORY = [
  { id: 'h1', date: '24.09.2026', title: 'Курс District · 8 занятий', price: '120' },
  { id: 'h2', date: '12.09.2026', title: 'Индивидуальные · 4 занятия', price: '90' },
  { id: 'h3', date: '03.09.2026', title: 'Индивидуальное · 1 занятие', price: '25' },
  { id: 'h4', date: '20.08.2026', title: 'Групповые · 8 занятий', price: '80' },
  { id: 'h5', date: '02.08.2026', title: 'Курс District · 8 занятий', price: '120' },
];

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

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const NAV_GROUPS = [
  {
    label: 'Обучение',
    items: [
      { id: 'lessons', label: 'Занятия', icon: 'course' },
      { id: 'schedule', label: 'Расписание', icon: 'clock' },
      { id: 'payments', label: 'Пакеты', icon: 'payments' },
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
  course: 'M5 3h14v18l-7-4-7 4V3z M9 8h6 M9 12h6',
  individual: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a5.5 5.5 0 0 1 11 0 M16 4.6a3.5 3.5 0 0 1 0 6.8 M17.5 14.6a5.5 5.5 0 0 1 4 5.4',
  homework: 'M6 2h9l5 5v15H6V2z M14 2v6h6 M9 13h6 M9 17h6',
  results: 'M3 20h18 M6 16l4-5 3 3 5-7',
  payments: 'M2 6h20v12H2V6z M2 10h20 M6 15h4',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6 M10 19a2 2 0 0 0 4 0',
  support: 'M4 12a8 8 0 0 1 16 0 M4 12v4a2 2 0 0 0 2 2h2v-6H4 M20 12v4a2 2 0 0 1-2 2h-2v-6h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9 17 7 M7 17l-2.1 2.1',
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
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3.5 2',
  burger: 'M4 7h16 M4 12h16 M4 17h16',
  plus: 'M12 5v14 M5 12h14',
  rocket: 'M12 2c3 2 5 6 5 10l3 4-4-1a8 8 0 0 1-8 0l-4 1 3-4c0-4 2-8 5-10z M12 9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z M9 19l-1.5 3 M15 19l1.5 3',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  expand: 'M8 3H3v5 M16 3h5v5 M8 21H3v-5 M16 21h5v-5',
  screen: 'M3 4h18v11H3V4z M12 15v4 M8 21h8 M7 8h7 M7 11h5',
  flask: 'M9 3h6 M10 3v6.5L5.6 17A2 2 0 0 0 7.4 20h9.2a2 2 0 0 0 1.8-3L14 9.5V3 M7.8 14h8.4',
  exit: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
};

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
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

function initials(name: string): string {
  /* локаль зафиксирована, чтобы SSR и браузер дали одинаковый результат */
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toLocaleUpperCase('ru-RU'))
    .join('');
}

/* ---------------------------- Путь курса (дорога с остановками) ---------- */

const RM_STEP_X = 120; // шаг занятия: карточки на каждой остановке, чередуются верх/низ
const RM_LEFT = 100;
const RM_MID = 140;
const RM_AMP = 30; // мягкая волна: дорога тонкая, без резких зигзагов
const RM_GAP = 100; // разрыв дороги между кварталами-модулями
const RM_CANVAS_H = 270;

/* Индексы сегментов на стыках модулей — здесь дорога прерывается. */
const RM_MODULE_BREAK = new Set(
  DEMO_STOPS.slice(0, -1).map((s, i) => (s.module !== DEMO_STOPS[i + 1].module ? i : -1)).filter((i) => i >= 0)
);

const RM_CANVAS_W = RM_LEFT * 2 + (DEMO_STOPS.length - 1) * RM_STEP_X + RM_MODULE_BREAK.size * RM_GAP + 170;

type RmPt = { x: number; y: number };

/* После стыка модулей дорога сдвигается на RM_GAP, а волна пути идёт по индексу
   внутри модуля — у каждого квартала свой рисунок улицы. */
const RM_PTS: RmPt[] = DEMO_STOPS.map((s, i) => {
  let gaps = 0;
  for (let k = 0; k < i; k += 1) if (RM_MODULE_BREAK.has(k)) gaps += 1;
  return {
    x: RM_LEFT + i * RM_STEP_X + gaps * RM_GAP,
    y: Math.round(RM_MID + RM_AMP * Math.sin(s.numInModule * 0.45 + s.module * 0.9)),
  };
});

/* Catmull-Rom по произвольному набору точек прогона. */
function rmSpline(pts: RmPt[]): string {
  let d = '';
  for (let k = 0; k < pts.length - 1; k += 1) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[k];
    const c = pts[k + 1];
    const e = pts[Math.min(pts.length - 1, k + 2)];
    const steps = 14;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * b.x + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - e.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + e.x) * t3);
      const y = 0.5 * (2 * b.y + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - e.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + e.y) * t3);
      d += `${k === 0 && s === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  }
  return d.trim();
}

/* Каждый прогон — спокойная волна между остановками: лёгкий изгиб то вверх, то вниз. */
function rmSegRoad(i: number): string {
  const a = RM_PTS[i];
  const b = RM_PTS[i + 1];
  const dx = b.x - a.x;
  const lift = (i % 2 === 0 ? -1 : 1) * 26;
  const mid: RmPt = { x: a.x + dx * 0.5, y: (a.y + b.y) / 2 + lift };
  return rmSpline([a, mid, b]);
}

const RM_SEG_ROADS: string[] = DEMO_STOPS.slice(0, -1).map((_, i) => rmSegRoad(i));

/* Старт пути: дорога начинается здесь и заканчивается первой остановкой. */
const RM_START: RmPt = { x: 46, y: RM_PTS[0].y + 28 };
const RM_START_ROAD = rmSpline([RM_START, { x: RM_PTS[0].x - 52, y: RM_PTS[0].y + 14 }, RM_PTS[0]]);

/* Пунктирный след через разрыв между кварталами. */
function rmBreakPath(i: number): string {
  const a = RM_PTS[i];
  const b = RM_PTS[i + 1];
  return `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 46} ${b.x} ${b.y}`;
}

function stopLabel(status: StopStatus): string {
  return status === 'watched' ? 'Просмотрено' : status === 'done' ? 'Пройдено' : status === 'now' ? 'Текущее занятие' : 'Заблокировано';
}

function CourseMap({ selected, onSelect }: { selected: number; onSelect: (id: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 0, width: 1 });
  const nowIndex = DEMO_STOPS.findIndex((s) => s.status === 'now');
  const last = RM_PTS[RM_PTS.length - 1];

  /* Позиция бегунка навигатора: доля видимой области во всём маршруте. */
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

  /* Клик/драг по треку: центр бегунка прыгает в выбранное место маршрута. */
  const jumpTo = (clientX: number) => {
    const track = trackRef.current;
    const wrap = wrapRef.current;
    if (!track || !wrap) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const max = wrap.scrollWidth - wrap.clientWidth;
    wrap.scrollLeft = Math.min(max, Math.max(0, frac * wrap.scrollWidth - wrap.clientWidth / 2));
  };

  /* Плавно доводим выбранную остановку до центра экрана (easeOutCubic). */
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
    <div className="cab-roadmap-frame">
      <div className="cab-roadmap" id="cab-roadmap-scroll" ref={wrapRef} onScroll={syncThumb} aria-label="Путь по курсу">
        <div className="cab-roadmap-canvas" style={{ width: RM_CANVAS_W }}>
          <svg className="cab-roadmap-svg" width={RM_CANVAS_W} height={RM_CANVAS_H} aria-hidden="true">
            {/* прогон от старта до первой остановки */}
            <g>
              <path d={RM_START_ROAD} fill="none" stroke="#0b1428" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
              <path d={RM_START_ROAD} fill="none" stroke="#46536f" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              <path d={RM_START_ROAD} fill="none" stroke="rgba(220, 232, 255, 0.7)" strokeWidth="1.8" strokeDasharray="10 14" strokeLinecap="round" />
            </g>
            {/* тонкая дорога: тёмная кромка, приглушённое полотно, пунктирная разметка;
                на пройденных участках — мягкий cyan-отсвет */}
            {DEMO_STOPS.slice(0, -1).map((s, i) => {
              if (RM_MODULE_BREAK.has(i)) return null;
              const passed = i < nowIndex;
              const road = RM_SEG_ROADS[i];
              return (
                <g key={i}>
                  {passed && (
                    <path d={road} fill="none" stroke="#3fb9dc" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" opacity="0.14" />
                  )}
                  <path d={road} fill="none" stroke="#0b1428" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={road} fill="none" stroke={passed ? '#50607f' : '#46536f'} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
                  <path d={road} fill="none" stroke="rgba(220, 232, 255, 0.7)" strokeWidth="1.8" strokeDasharray="10 14" strokeLinecap="round" opacity={passed ? 0.8 : 0.45} />
                </g>
              );
            })}
            {/* тени-подушки под остановками */}
            {RM_PTS.map((p, i) => (
              <ellipse key={i} cx={p.x} cy={p.y + 2} rx="12" ry="7" fill="rgba(5, 9, 20, 0.55)" />
            ))}
            {/* точка старта */}
            <circle cx={RM_START.x} cy={RM_START.y} r="13" className="cab-rm-start-bg" />
            <text x={RM_START.x} y={RM_START.y + 32} textAnchor="middle" className="cab-rm-start-label">СТАРТ</text>
            {/* граница кварталов: нейтральный пунктир + столбики */}
            {[...RM_MODULE_BREAK].map((i) => {
              const a = RM_PTS[i];
              const b = RM_PTS[i + 1];
              return (
                <g key={i} opacity="0.55">
                  <path d={rmBreakPath(i)} fill="none" stroke="#4a5a80" strokeWidth="2" strokeDasharray="4 10" strokeLinecap="round" />
                  <line x1={a.x + 26} y1={a.y - 12} x2={a.x + 26} y2={a.y + 12} stroke="#3d4f7c" strokeWidth="2" strokeLinecap="round" />
                  <line x1={b.x - 26} y1={b.y - 12} x2={b.x - 26} y2={b.y + 12} stroke="#3d4f7c" strokeWidth="2" strokeLinecap="round" />
                </g>
              );
            })}
            {/* финиш курса */}
            <path d={`M ${last.x} ${last.y} L ${last.x + 120} ${last.y}`} stroke="#1c2947" strokeWidth="9" strokeLinecap="round" />
            <circle cx={last.x + 120} cy={last.y} r="16" className="cab-rm-finish-bg" />
            <path d={ICONS.trophy} className="cab-rm-finish-trophy" fill="none" transform={`translate(${last.x + 110} ${last.y - 10}) scale(0.83)`} />
            <text x={last.x + 120} y={last.y - 26} textAnchor="middle" className="cab-rm-finish-label">ФИНИШ</text>
          </svg>

          {DEMO_STOPS.map((s, i) => {
            const p = RM_PTS[i];
            const label = stopLabel(s.status);
            /* врата модуля — на первом занятии модуля, как на референсе */
            const isGate = s.numInModule === 1;
            const moduleStops = DEMO_STOPS.filter((t) => t.module === s.module);
            const moduleDone = moduleStops.every((t) => t.status === 'watched' || t.status === 'done');
            const moduleNow = nowIndex >= 0 && DEMO_STOPS[nowIndex].module === s.module;
            return (
              <div
                key={s.id}
                data-stop={s.id}
                className={`cab-rm-stop is-${s.status} kind-${s.kind}${selected === s.id ? ' is-selected' : ''}${i % 2 === 0 ? ' plate-top' : ' plate-bottom'}`}
                style={{ left: p.x, top: p.y }}
              >
                <span className="cab-rm-stem" aria-hidden="true" />
                <button
                  type="button"
                  className="cab-rm-node"
                  onClick={() => onSelect(s.id)}
                  disabled={s.status === 'locked'}
                  title={label}
                  aria-label={`${label}: ${isGate ? DEMO_MODULES[s.module].name : s.title}`}
                >
                  {s.status === 'now' && <span className="cab-rm-ping" aria-hidden="true" />}
                </button>
                <button type="button" className={`cab-rm-plate${isGate ? ' is-gate' : ''}`} onClick={() => onSelect(s.id)} disabled={s.status === 'locked'}>
                  {isGate ? (
                    <>
                      <span className="cab-rm-plate-top">
                        <b>{`М${s.module + 1}`}</b>
                        <em>
                          {MODULE_RANGES[s.module].start + 1}–{MODULE_RANGES[s.module].end + 1}
                        </em>
                      </span>
                      <span className="cab-rm-title">{DEMO_MODULES[s.module].name}</span>
                      <span className="cab-rm-gate-foot">
                        <span className={`cab-rm-gate-ico${moduleDone ? ' is-done' : moduleNow ? ' is-now' : ' is-locked'}`}>
                          <Icon d={moduleDone ? ICONS.check : moduleNow ? ICONS.play : ICONS.lock} />
                        </span>
                        <span className="cab-rm-label">{moduleDone ? 'Пройден' : moduleNow ? 'Сейчас' : 'Впереди'}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cab-rm-plate-top">
                        <b>{`М${s.module + 1} · ${s.numInModule}`}</b>
                        <em>{s.date}</em>
                      </span>
                      <span className="cab-rm-title">{s.title}</span>
                      <span className="cab-rm-label">{label}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* навигатор маршрута: положение видимой области внутри всех 74 точек */}
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
          {MODULE_RANGES.map((r, mi) => (
            <i
              key={mi}
              className="cab-rm-nav-mark"
              style={{ left: `${(RM_PTS[r.start].x / RM_CANVAS_W) * 100}%`, ['--mark-color' as string]: DEMO_MODULES[mi].color }}
            />
          ))}
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

function LivesWidget() {
  return (
    <div className="cab-lives" title="Твои жизни">
      <div className="cab-lives-head">
        <span className="cab-k">Жизни</span>
        <button type="button" className="cab-lives-plus" title="Восстановить жизни">
          <Icon d={ICONS.plus} />
        </button>
      </div>
      <span className="cab-lives-hearts">
        {Array.from({ length: DEMO_LIVES.total }).map((_, i) => (
          <Heart key={i} filled={i < DEMO_LIVES.full} />
        ))}
      </span>
      <span className="cab-lives-timer">
        Восстановление через <b>{DEMO_LIVES.restore}</b>
      </span>
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

export default function CabinetShell({ data }: { data: CabinetData }) {
  const router = useRouter();
  const [section, setSection] = useState<SectionId>('lessons');
  const [mode, setMode] = useState<CabinetMode>('course');
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [stopId, setStopId] = useState<number>(DEMO_STOPS.find((s) => s.status === 'now')?.id ?? 1);
  const [indLessonId, setIndLessonId] = useState<string>(DEMO_IND_LESSONS[0].id);
  const [indTab, setIndTab] = useState<'upcoming' | 'done'>('upcoming');
  const [indKind, setIndKind] = useState<'individual' | 'group'>('individual');
  const [schedView, setSchedView] = useState<'week' | 'month'>('week');
  const [schedFilter, setSchedFilter] = useState<'all' | SchedKind>('all');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [monthSelected, setMonthSelected] = useState<string | null>(null);
  const [pkgHistoryAll, setPkgHistoryAll] = useState(false);
  const [profileSaved, setProfileSaved] = useState({ name: '', klass: DEMO_PROFILE.level.split(' ')[0] ?? '10', goal: 'Подготовка к ЦТ' });
  const [profileDraft, setProfileDraft] = useState<{ name: string; klass: string; goal: string } | null>(null);

  const displayName = data.studentName ?? DEMO_PROFILE.name; // TEMP: демо-имя, пока нет реального
  const days = daysInSystem(data.createdAt);
  const curator = data.mentors.find((m) => m.kind === 'curator') ?? null;
  const teacher = data.mentors.find((m) => m.kind === 'teacher') ?? null;
  const teacherName = teacher?.name ?? 'Кристина Денисовна'; // TEMP: демо-имя, пока нет реального
  const contactIsMentor = section === 'lessons' && mode === 'individual';

  const stop = DEMO_STOPS.find((s) => s.id === stopId) ?? DEMO_STOPS[0];
  const stopModule = DEMO_MODULES[stop.module];
  const indLesson = DEMO_IND_LESSONS.find((l) => l.id === indLessonId) ?? DEMO_IND_LESSONS[0];

  /* Индивидуальные и групповые: TEMP-демо — считаем всё купленным,
     переключатель показываем всегда. Позже заменить на проверки data.accesses. */
  const hasIndividual = true;
  const hasGroup = true;
  const kindLessons = DEMO_IND_LESSONS.filter((l) => l.kind === indKind);
  const nextLesson = kindLessons.find((l) => l.status === 'upcoming') ?? null;
  const nextDate = nextLesson ? dateParts(nextLesson.date) : null;

  function switchIndKind(kind: 'individual' | 'group') {
    setIndKind(kind);
    const first =
      DEMO_IND_LESSONS.find((l) => l.kind === kind && l.status === 'upcoming') ??
      DEMO_IND_LESSONS.find((l) => l.kind === kind);
    if (first) setIndLessonId(first.id);
  }

  /* ——— Расписание ——— */
  const now = new Date();
  const todayKey = dayKey(now);
  const schedLessons = DEMO_SCHED_LESSONS.filter((l) => schedFilter === 'all' || l.kind === schedFilter);
  const schedNearest =
    [...schedLessons].filter((l) => l.date.getTime() >= now.getTime() - 60 * 60 * 1000).sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;
  const schedUpcoming = schedLessons.filter((l) => l.date.getTime() >= now.getTime()).sort((a, b) => a.date.getTime() - b.date.getTime());

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekLessonsByDay = weekDays.map((d) => schedLessons.filter((l) => dayKey(l.date) === dayKey(d)));
  const schedLabel =
    schedView === 'week'
      ? `${MONTHS_NOM[weekStart.getMonth()]} ${weekStart.getFullYear()}`
      : `${MONTHS_NOM[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  function shiftSched(dir: 1 | -1) {
    if (schedView === 'week') {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + dir * 7);
      setWeekStart(d);
    } else {
      setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + dir, 1));
    }
  }

  /* месячная сетка: пустые ячейки до 1-го числа + дни месяца */
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: (monthCursor.getDay() + 6) % 7 }, () => null),
    ...Array.from({ length: new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate() }, (_, i) => {
      const d = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), i + 1);
      return d;
    }),
  ];
  const monthSelectedDate = monthSelected ? new Date(monthSelected) : null;
  const monthDayLessons = monthSelectedDate ? schedLessons.filter((l) => dayKey(l.date) === dayKey(monthSelectedDate)) : [];

  /* ——— Настройки профиля ——— */
  /* TEMP: класс и цель пока хранятся локально — для записи в базу потребуется
     соответствующее поле/API в Supabase (сейчас возвращаются только имя и телефон). */
  const profileName = profileSaved.name || data.studentName || DEMO_PROFILE.name;
  const studentId = `#${data.phone.replace(/\D/g, '').slice(-5).padStart(5, '0')}`;

  /* ——— Пакеты ——— */
  const coursePkg = DEMO_MY_PACKAGES.find((p) => p.id === 'p-course') ?? null;
  const secondaryPackages = DEMO_MY_PACKAGES.filter((p) => p.id !== 'p-course');

  function startProfileEdit() {
    setProfileDraft({
      name: profileName,
      klass: profileSaved.klass || GRADES[5],
      goal: STUDY_GOALS.includes(profileSaved.goal) ? profileSaved.goal : STUDY_GOALS[2],
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <div className="cabinet">
      <div className={`cab-backdrop${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`cab-sidebar${menuOpen ? ' is-open' : ''}`}>
        <button type="button" className="cab-brand" onClick={() => router.push('/')} title="Вернуться на сайт">
          <span className="logo-icon" aria-hidden="true" />
          <span className="cab-brand-name">District</span>
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
                  <Icon d={ICONS[item.icon]} className="cab-nav-icon" />
                  <span className="cab-nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="cab-sidebar-footer">
          <div className="cab-user-mini">
            <span className="cab-avatar-sm">{initials(displayName)}</span>
            <span className="cab-user-mini-name">
              <strong>{displayName}</strong>
              <span>{data.phone}</span>
            </span>
          </div>
          <button type="button" className="cab-nav-item cab-nav-logout" onClick={handleSignOut} disabled={signingOut}>
            <Icon d={ICONS.exit} className="cab-nav-icon" />
            <span className="cab-nav-label">{signingOut ? 'Выходим…' : 'Выйти'}</span>
          </button>
        </div>
      </aside>

      <div className="cab-main">
        <header className="cab-pagehead">
          <button type="button" className="cab-burger" onClick={() => setMenuOpen(true)} aria-label="Открыть меню">
            <Icon d={ICONS.burger} />
          </button>
          <button type="button" className="cab-back" onClick={() => router.back()} aria-label="Вернуться назад">
            <Icon d={ICONS.back} />
          </button>
          <div>
            <h1>Личный кабинет</h1>
            <p>Твоё обучение. Твой прогресс. Твой результат.</p>
          </div>
        </header>

        <div className="cab-body">
          <main className="cab-content">
            {section === 'lessons' && (
              <div className="cab-tabs" role="tablist" aria-label="Режим кабинета">
                <button type="button" role="tab" aria-selected={mode === 'course'} className={`cab-tab${mode === 'course' ? ' is-active' : ''}`} onClick={() => setMode('course')}>
                  Кабинет курса
                </button>
                <button type="button" role="tab" aria-selected={mode === 'individual'} className={`cab-tab${mode === 'individual' ? ' is-active' : ''}`} onClick={() => setMode('individual')}>
                  Кабинет занятий
                </button>
              </div>
            )}

            {section === 'lessons' && mode === 'course' && (
              <div className="cab-stack">
                <section className="cab-panel cab-path-panel">
                  <header className="cab-panel-head">
                    <h3>Твой путь по курсу</h3>
                  </header>
                  <div className="cab-path-head">
                    <div className="cab-path-progress">
                      <span className="cab-k">Твой прогресс</span>
                      <strong>{DEMO_PROGRESS}%</strong>
                      <span className="cab-path-sub">
                        {DEMO_DONE_COUNT} из {DEMO_STOPS.length} занятий
                      </span>
                      <span className="cab-path-bar" aria-hidden="true">
                        <i style={{ width: `${DEMO_PROGRESS}%` }} />
                      </span>
                    </div>
                    <div className="cab-path-topic">
                      <span className="cab-k">Текущая тема</span>
                      <div className="cab-topic-row">
                        <strong>{stop.title}</strong>
                        <span className="cab-topic-mod">{`М${stop.module + 1} · ${stop.numInModule}`}</span>
                      </div>
                      <p className="cab-topic-desc">{stopModule.about}</p>
                    </div>
                    <LivesWidget />
                  </div>
                  <CourseMap selected={stopId} onSelect={setStopId} />
                  <div className="cab-mods">
                    {DEMO_MODULES.map((m, mi) => (
                      <span key={m.name} className="cab-mod">
                        <i style={{ background: m.color }} />
                        <b>М{mi + 1}</b> {m.name}
                        <em>
                          {MODULE_RANGES[mi].start + 1}–{MODULE_RANGES[mi].end + 1}
                        </em>
                      </span>
                    ))}
                  </div>
                </section>

                <section className="cab-panel cab-module-panel">
                  <header className="cab-panel-head">
                    <h3 className="cab-module-title" style={{ color: stopModule.color }}>
                      {`0${stop.module + 1}`.slice(-2)} · {stopModule.name}
                    </h3>
                    <span className="cab-module-sub">
                      Занятие {stop.numInModule} из {stopModule.count}
                    </span>
                    {stop.status === 'now' && <span className="cab-badge-now">Сейчас</span>}
                  </header>
                  <div key={stop.id} className="cab-module-grid cab-anim-pop">
                    <div className="cab-video">
                      <div className="cab-video-top">
                        <strong>{stop.title}</strong>
                        <span>Занятие {stop.numInModule}</span>
                      </div>
                      <button type="button" className="cab-video-play" aria-label="Смотреть занятие">
                        <Icon d={ICONS.play} />
                      </button>
                      <div className="cab-video-bar">
                        <i style={{ width: stop.status === 'watched' || stop.status === 'done' ? '95%' : '48%' }} />
                      </div>
                      <div className="cab-video-meta">
                        <span>{stop.status === 'watched' || stop.status === 'done' ? '1:02:10 / 1:05:00' : '42:15 / 1:28:40'}</span>
                        <Icon d={ICONS.expand} className="cab-video-expand" />
                      </div>
                    </div>
                    <div className="cab-about">
                      <h4>О чём занятие</h4>
                      <p>{stopModule.about}</p>
                      <ul className="cab-checks">
                        {['Теория', 'Разбор задач', 'Практика', 'Домашнее задание'].map((label, ci) => {
                          const done = stop.status === 'watched' || stop.status === 'done' ? true : ci < 3;
                          return (
                            <li key={label} className={done ? 'is-done' : ''}>
                              <span className="cab-check-ico">{done ? <Icon d={ICONS.check} /> : <i />}</span>
                              {label}
                            </li>
                          );
                        })}
                      </ul>
                      <button type="button" className="cab-btn cab-btn--orange">Открыть занятие</button>
                    </div>
                    <div className="cab-files">
                      <h4>Файлы к занятию</h4>
                      {DEMO_FILES.map((f) => (
                        <div key={f.name} className="cab-file">
                          <Icon d={ICONS.file} className="cab-file-ico" />
                          <span className="cab-file-name">{f.name}</span>
                          <span className="cab-file-size">{f.size}</span>
                          <button type="button" className="cab-file-dl" aria-label={`Скачать ${f.name}`}>
                            <Icon d={ICONS.download} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {section === 'lessons' && mode === 'individual' && (
              <div className={`cab-stack cab-ind-scope${indKind === 'group' ? ' kind-group' : ''}`}>
                <div className="cab-ind-head">
                  <h2>{indKind === 'group' ? 'Мои групповые занятия' : 'Мои индивидуальные занятия'}</h2>
                  <p>
                    {indKind === 'group'
                      ? 'Мини-группы: живое общение, разбор задач и мотивация'
                      : 'Занимайся с преподавателем и достигай максимального результата'}
                  </p>
                  {hasIndividual && hasGroup && (
                    <div className="cab-ind-switch" role="tablist" aria-label="Тип занятий">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={indKind === 'individual'}
                        className={`cab-ind-switch-btn${indKind === 'individual' ? ' is-active' : ''}`}
                        onClick={() => switchIndKind('individual')}
                      >
                        <Icon d={ICONS.individual} className="cab-ind-switch-ico" />
                        Индивидуальные
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={indKind === 'group'}
                        className={`cab-ind-switch-btn is-group${indKind === 'group' ? ' is-active' : ''}`}
                        onClick={() => switchIndKind('group')}
                      >
                        <Icon d={ICONS.users} className="cab-ind-switch-ico" />
                        Групповые
                      </button>
                    </div>
                  )}
                </div>

                {!(hasIndividual || hasGroup) ? (
                  <section className="cab-panel">
                    <ComingSoon text="Занятия появятся здесь после покупки индивидуальных или групповых занятий." />
                  </section>
                ) : !nextLesson ? (
                  <section className="cab-panel">
                    <ComingSoon
                      text={indKind === 'group' ? 'Предстоящих групповых занятий пока нет.' : 'Предстоящих индивидуальных занятий пока нет.'}
                    />
                  </section>
                ) : (
                  <>
                    <section className="cab-panel cab-ind-next">
                      <div className="cab-ind-kicker">
                        <i aria-hidden="true" />
                        {indKind === 'group' ? 'Следующее групповое занятие' : 'Следующее занятие'}
                      </div>
                      {indKind === 'group' && (
                        <div className="cab-group-meta">
                          <span className="cab-group-avatars" aria-hidden="true">
                            <i>КД</i>
                            <i>АМ</i>
                            <i>ДС</i>
                            <em>+3</em>
                          </span>
                          <span className="cab-group-name">Мини-группа №2 · 6 учеников</span>
                        </div>
                      )}
                      <div className="cab-ind-next-grid">
                        <div className="cab-ind-date">
                          <strong>{nextDate?.day}</strong>
                          <span>{nextDate?.month}</span>
                          <em>{nextDate?.weekday}</em>
                        </div>
                        <div className="cab-ind-time">
                          <strong>{nextLesson.time}</strong>
                          <span>60 минут</span>
                        </div>
                        <div className="cab-ind-topic">
                          <span className="cab-k">Тема занятия</span>
                          <strong>{nextLesson.topic}</strong>
                          <span className="cab-k">Преподаватель</span>
                          <span className="cab-ind-teacher">
                            <i>{initials(teacherName)}</i>
                            {teacherName}
                          </span>
                        </div>
                        <ul className="cab-ind-how">
                          <li>
                            <Icon d={ICONS.check} /> Онлайн-встреча, 60 минут
                          </li>
                          <li>
                            <Icon d={ICONS.send} /> Ссылка придёт в Telegram за 15 минут
                          </li>
                          <li>
                            <Icon d={ICONS.file} /> Запись и конспект останутся у тебя
                          </li>
                        </ul>
                      </div>
                      <div className="cab-ind-actions">
                        <button type="button" className="cab-btn cab-btn--join cab-ind-join">
                          Подключиться к занятию <Icon d={ICONS.chevron} />
                        </button>
                        <a className="cab-btn cab-btn--line" href={tgBotUrl(indKind === 'group' ? 'mentor' : 'mentor')} target="_blank" rel="noopener noreferrer">
                          Сдать домашку <Icon d={ICONS.send} />
                        </a>
                      </div>
                    </section>

                    <div className="cab-ind-grid">
                      <section className="cab-panel">
                        <header className="cab-panel-head">
                          <h3>Мои занятия</h3>
                          <span className="cab-panel-hint">выбери, чтобы увидеть материалы и домашку</span>
                        </header>
                        <div className="cab-ind-tabs" role="tablist" aria-label="Фильтр занятий">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={indTab === 'upcoming'}
                            className={`cab-ind-tab${indTab === 'upcoming' ? ' is-active' : ''}`}
                            onClick={() => {
                              setIndTab('upcoming');
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
                              const first = kindLessons.find((l) => l.status === 'done');
                              if (first) setIndLessonId(first.id);
                            }}
                          >
                            Завершённые <b>{kindLessons.filter((l) => l.status === 'done').length}</b>
                          </button>
                        </div>
                        <div className="cab-ind-list">
                          {kindLessons.filter((l) => l.status === indTab).map((l) => (
                            <button key={l.id} type="button" className={`cab-ind-row${indLessonId === l.id ? ' is-selected' : ''}`} onClick={() => setIndLessonId(l.id)}>
                              <span className="cab-ind-cell-date">
                                {l.date} <em>{l.time}</em>
                              </span>
                              <span className="cab-ind-cell-topic">{l.topic}</span>
                              <span className={`cab-ind-status is-${l.status === 'upcoming' ? 'upcoming' : 'done'}`}>
                                {l.status === 'upcoming' ? 'Предстоит' : 'Завершено'}
                              </span>
                              <Icon d={ICONS.chevron} className="cab-ind-chev" />
                            </button>
                          ))}
                        </div>
                      </section>

                      <div key={indLesson.id} className="cab-ind-side cab-anim-pop">
                        <section className="cab-panel">
                          <header className="cab-panel-head">
                            <h3>Материалы с уроков</h3>
                          </header>
                          {indLesson.status === 'done' && indLesson.materials.length > 0 ? (
                            <div className="cab-files cab-files--plain">
                              {indLesson.materials.map((f) => (
                                <div key={f.name} className="cab-file">
                                  <Icon d={ICONS.file} className="cab-file-ico" />
                                  <span className="cab-file-name">{f.name}</span>
                                  <span className="cab-file-size">{f.size}</span>
                                  <button type="button" className="cab-file-dl" aria-label={`Скачать ${f.name}`}>
                                    <Icon d={ICONS.download} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="cab-note">Материалы появятся после занятия.</p>
                          )}
                        </section>

                        <section className="cab-panel">
                          <header className="cab-panel-head">
                            <h3>Домашнее задание</h3>
                          </header>
                          {/* сдать домашку можно только за ближайшее занятие — кнопка в блоке выше */}
                          {indLesson.status === 'upcoming' ? (
                            <p className="cab-note">
                              Домашку можно сдать только за ближайшее занятие — кнопка «Сдать домашку» в блоке выше.
                            </p>
                          ) : indLesson.homework ? (
                            <div className="cab-hw">
                              <div className="cab-file cab-file--big">
                                <Icon d={ICONS.file} className="cab-file-ico" />
                                <span className="cab-file-name">{indLesson.homework.name}</span>
                                <span className="cab-file-size">{indLesson.homework.size}</span>
                              </div>
                              <button type="button" className="cab-btn cab-btn--line">
                                Открыть файл домашки <Icon d={ICONS.download} />
                              </button>
                            </div>
                          ) : (
                            <p className="cab-note">Домашка появится здесь после занятия.</p>
                          )}
                        </section>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {section === 'schedule' && (
              <div className="cab-stack">
                <header className="cab-sched-head">
                  <div>
                    <h2>Расписание</h2>
                    <p>Твои предстоящие занятия</p>
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
                    <button
                      type="button"
                      className="cab-btn cab-btn--line cab-sched-today"
                      onClick={() => {
                        setWeekStart(startOfWeek(new Date()));
                        setMonthCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                        setMonthSelected(null);
                      }}
                    >
                      Сегодня
                    </button>
                  </div>
                </header>

                <div className="cab-sched-controls">
                  <div className="cab-sched-views" role="tablist" aria-label="Режим расписания">
                    <button type="button" role="tab" aria-selected={schedView === 'week'} className={`cab-ind-tab${schedView === 'week' ? ' is-active' : ''}`} onClick={() => setSchedView('week')}>
                      Неделя
                    </button>
                    <button type="button" role="tab" aria-selected={schedView === 'month'} className={`cab-ind-tab${schedView === 'month' ? ' is-active' : ''}`} onClick={() => setSchedView('month')}>
                      Месяц
                    </button>
                  </div>
                  <div className="cab-sched-filters" role="tablist" aria-label="Фильтр занятий">
                    <button type="button" role="tab" aria-selected={schedFilter === 'all'} className={`cab-sched-filter${schedFilter === 'all' ? ' is-active' : ''}`} onClick={() => setSchedFilter('all')}>
                      Все
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schedFilter === 'individual'}
                      className={`cab-sched-filter${schedFilter === 'individual' ? ' is-active' : ''}`}
                      onClick={() => setSchedFilter('individual')}
                    >
                      Индивидуальные
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schedFilter === 'group'}
                      className={`cab-sched-filter${schedFilter === 'group' ? ' is-active' : ''}`}
                      onClick={() => setSchedFilter('group')}
                    >
                      Групповые
                    </button>
                  </div>
                </div>

                <div className="cab-sched-layout">
                  <section className="cab-panel cab-sched-grid-panel">
                    {schedView === 'week' ? (
                      <div className="cab-sched-week" role="grid" aria-label="Недельное расписание">
                        <div className="cab-sched-timecol">
                          <span className="cab-sched-timecol-head" />
                          {Array.from({ length: SCHED_HOURS }, (_, i) => (
                            <span key={i} className="cab-sched-hour">
                              {`${SCHED_START_HOUR + i}:00`}
                            </span>
                          ))}
                        </div>
                        {weekDays.map((day, di) => {
                          const isToday = dayKey(day) === todayKey;
                          return (
                            <div key={di} className={`cab-sched-day${isToday ? ' is-today' : ''}`}>
                              <header className="cab-sched-dayhead">
                                <span className="cab-sched-dayname">{DAY_HEADERS[di]}</span>
                                {/*suppressHydrationWarning: даты считаются на клиенте*/}
                                <b suppressHydrationWarning>{day.getDate()}</b>
                              </header>
                              <div className="cab-sched-daygrid">
                                {weekLessonsByDay[di].length > 0 ? (
                                  layoutColumns(weekLessonsByDay[di]).map(({ lesson, col, cols }) => {
                                    const start = minutesOf(lesson.time);
                                    const top = ((start - SCHED_START_HOUR * 60) / 60) * HOUR_PX;
                                    return (
                                      <div
                                        key={lesson.id}
                                        className={`cab-lesson k-${lesson.kind}`}
                                        style={{
                                          top: Math.max(0, top),
                                          height: Math.max(46, (lesson.duration / 60) * HOUR_PX - 6),
                                          left: `calc(${(col / cols) * 100}% + 3px)`,
                                          width: `calc(${100 / cols}% - 6px)`,
                                        }}
                                      >
                                        <span className="cab-lesson-kind">{SCHED_KIND_LABEL[lesson.kind]}</span>
                                        <strong>{lesson.title}</strong>
                                        <span className="cab-lesson-time">
                                          {lesson.time}–{endTime(lesson.time, lesson.duration)}
                                        </span>
                                        <span className="cab-lesson-teacher">{lesson.teacher}</span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <span className="cab-sched-empty-day" aria-hidden="true" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
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
                                className={`cab-sched-cell${dayKey(d) === todayKey ? ' is-today' : ''}${monthSelected && monthSelected === dayKey(d) ? ' is-selected' : ''}`}
                                onClick={() => setMonthSelected(dayKey(d))}
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
                        <div className="cab-sched-monthlist">
                          <span className="cab-k">
                            {monthSelectedDate
                              ? `${monthSelectedDate.getDate()} ${MONTHS_GEN[monthSelectedDate.getMonth()]}`
                              : 'Выбери день'}
                          </span>
                          {monthSelectedDate ? (
                            monthDayLessons.length > 0 ? (
                              monthDayLessons
                                .sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
                                .map((l) => (
                                  <div key={l.id} className="cab-sched-monthrow">
                                    <em>{l.time}</em>
                                    <strong>{l.title}</strong>
                                    <span className={`cab-schedule-kind k-${l.kind}`}>{SCHED_KIND_LABEL[l.kind]}</span>
                                  </div>
                                ))
                            ) : (
                              <p className="cab-note">В этот день занятий нет.</p>
                            )
                          ) : (
                            <p className="cab-note">Нажми на день с точками — покажу его занятия.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </section>

                  <aside className="cab-panel cab-sched-next">
                    {schedNearest ? (
                      <>
                        <span className="cab-k">Ближайшее</span>
                        {/*suppressHydrationWarning: даты считаются на клиенте*/}
                        <strong className="cab-sched-next-when" suppressHydrationWarning>
                          {dayKey(schedNearest.date) === todayKey
                            ? 'Сегодня'
                            : `${WEEKDAYS[schedNearest.date.getDay()]} · ${schedNearest.date.getDate()} ${MONTHS_GEN[schedNearest.date.getMonth()]}`}{' '}
                          · {schedNearest.time}
                        </strong>
                        <strong className="cab-sched-next-title">{schedNearest.title}</strong>
                        <span className={`cab-schedule-kind k-${schedNearest.kind}`}>{SCHED_KIND_LABEL[schedNearest.kind]}</span>
                        <span className="cab-sched-next-teacher">
                          <i>{initials(schedNearest.teacher)}</i>
                          {schedNearest.teacher}
                        </span>
                        <span className="cab-sched-next-meta">{schedNearest.duration} минут · Онлайн</span>
                        <button type="button" className="cab-btn cab-btn--join cab-sched-next-cta">
                          Подключиться <Icon d={ICONS.chevron} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="cab-k">Ближайшее</span>
                        <p className="cab-note">Предстоящих занятий нет — загляни в раздел «Пакеты».</p>
                      </>
                    )}
                  </aside>
                </div>

                <section className="cab-panel">
                  <header className="cab-panel-head">
                    <h3>Предстоящие</h3>
                    <span className="cab-panel-hint">{schedUpcoming.length ? `${schedUpcoming.length} занятий` : undefined}</span>
                  </header>
                  {schedUpcoming.length > 0 ? (
                    <ul className="cab-sched-upcoming">
                      {schedUpcoming.map((l) => (
                        <li key={l.id}>
                          {/*suppressHydrationWarning: даты считаются на клиенте*/}
                          <span className="cab-up-date" suppressHydrationWarning>
                            <b>{String(l.date.getDate()).padStart(2, '0')}</b>
                            <span>{MONTHS_SHORT[l.date.getMonth()]}</span>
                          </span>
                          <span className="cab-up-time">{l.time}</span>
                          <span className="cab-up-title">
                            <strong>{l.title}</strong>
                            <em>{l.teacher}</em>
                          </span>
                          <span className={`cab-schedule-kind k-${l.kind}`}>{SCHED_KIND_LABEL[l.kind]}</span>
                          <button type="button" className="cab-btn cab-btn--line cab-up-action">
                            Подключиться
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="cab-sched-empty">
                      <strong>Пока занятий нет</strong>
                      <p>У тебя нет запланированных занятий на этот период.</p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'payments' && (
              <div className="cab-stack">
                <header className="cab-sched-head">
                  <div>
                    <h2>Пакеты</h2>
                    <p>Твои занятия и доступный баланс</p>
                  </div>
                </header>

                <section className="cab-panel cab-pkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">01 · Мои пакеты</span>
                  </header>

                  {/* курс — главный блок страницы */}
                  {coursePkg && (
                    <div className={`cab-pkg-hero${coursePkg.active ? '' : ' is-done'}`}>
                      <div className="cab-pkg-top">
                        <div className="cab-pkg-name">
                          <strong>Курс District</strong>
                          <span>{coursePkg.sub}</span>
                        </div>
                        <span className={`cab-pkg-status${coursePkg.active ? ' is-active' : ''}`}>
                          <i aria-hidden="true" />
                          {coursePkg.active ? 'Активен' : 'Пакет завершён'}
                        </span>
                      </div>
                      <div className="cab-pkg-hero-num">
                        <b>{coursePkg.remaining}</b>
                        <span>/ {coursePkg.total} {pluralLessons(coursePkg.total)} осталось</span>
                      </div>
                      <span className="cab-pkg-segments cab-pkg-segments--lg" aria-hidden="true">
                        {Array.from({ length: coursePkg.total }, (_, i) => (
                          <i key={i} className={i < coursePkg.remaining ? 'is-full' : ''} />
                        ))}
                      </span>
                      <footer className="cab-pkg-foot">
                        <span>{coursePkg.active ? `Текущий пакет · ${coursePkg.total} ${pluralLessons(coursePkg.total)}` : 'Все занятия пакета использованы'}</span>
                        <a className="cab-btn cab-btn--join" href="/cabinet/checkout?product=course">
                          {coursePkg.active ? 'Купить ещё' : 'Купить новый пакет'} <Icon d={ICONS.chevron} />
                        </a>
                      </footer>
                    </div>
                  )}

                  {/* индивидуальные и групповые — вторичный уровень */}
                  <div className="cab-pkg-grid2">
                    {secondaryPackages.map((p) => {
                      const product = p.id === 'p-group' ? 'group' : 'individual';
                      return (
                        <article key={p.id} className={`cab-pkg-mini${p.active ? '' : ' is-done'}`}>
                          <div className="cab-pkg-top">
                            <strong className="cab-pkg-mini-title">{p.title}</strong>
                            <span className={`cab-pkg-status${p.active ? ' is-active' : ''}`}>
                              <i aria-hidden="true" />
                              {p.active ? 'Активен' : 'Завершён'}
                            </span>
                          </div>
                          <span className="cab-pkg-mini-sub">{p.sub}</span>
                          <div className="cab-pkg-mini-num">
                            <b>{p.remaining}</b>
                            <span>/ {p.total} {pluralLessons(p.total)}</span>
                          </div>
                          <span className="cab-pkg-segments" aria-hidden="true">
                            {Array.from({ length: p.total }, (_, i) => (
                              <i key={i} className={i < p.remaining ? 'is-full' : ''} />
                            ))}
                          </span>
                          <a className="cab-btn cab-btn--line" href={`/cabinet/checkout?product=${product}`}>
                            {p.active ? 'Купить ещё' : 'Купить новый пакет'} <Icon d={ICONS.chevron} />
                          </a>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="cab-panel cab-pkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">02 · Пополнить пакет</span>
                  </header>
                  <div className="cab-pkg-refill">
                    <div className="cab-pkg-refill-group">
                      <span className="cab-k">Курс District</span>
                      <div className="cab-pkg-refill-row">
                        <span className="cab-pkg-refill-name">8 занятий · Алгебра + Геометрия</span>
                        <span className="cab-pkg-refill-price">120 BYN</span>
                        <a className="cab-pkg-refill-btn" href="/cabinet/checkout?product=course">
                          Выбрать <Icon d={ICONS.chevron} />
                        </a>
                      </div>
                    </div>
                    <div className="cab-pkg-refill-group">
                      <span className="cab-k">Индивидуальные</span>
                      {[
                        { n: 1, price: '25' },
                        { n: 4, price: '90' },
                        { n: 8, price: '160' },
                      ].map((o) => (
                        <div key={o.n} className="cab-pkg-refill-row">
                          <span className="cab-pkg-refill-name">{o.n} {pluralLessons(o.n)}</span>
                          <span className="cab-pkg-refill-price">{o.price} BYN</span>
                          <a className="cab-pkg-refill-btn" href="/cabinet/checkout?product=individual">
                            Выбрать <Icon d={ICONS.chevron} />
                          </a>
                        </div>
                      ))}
                    </div>
                    <div className="cab-pkg-refill-group">
                      <span className="cab-k">Групповые</span>
                      <div className="cab-pkg-refill-row">
                        <span className="cab-pkg-refill-name">8 занятий · мини-группа</span>
                        <span className="cab-pkg-refill-price">80 BYN</span>
                        <a className="cab-pkg-refill-btn" href="/cabinet/checkout?product=group">
                          Выбрать <Icon d={ICONS.chevron} />
                        </a>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="cab-panel cab-pkg-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">03 · История покупок</span>
                    <button type="button" className="cab-pkg-history-all" onClick={() => setPkgHistoryAll((v) => !v)}>
                      {pkgHistoryAll ? 'Свернуть' : 'Показать все'} <Icon d={ICONS.chevron} />
                    </button>
                  </header>
                  <ul className="cab-pkg-history">
                    {(pkgHistoryAll ? DEMO_PKG_HISTORY : DEMO_PKG_HISTORY.slice(0, 2)).map((h) => (
                      <li key={h.id}>
                        <span className="cab-h-date">{h.date}</span>
                        <span className="cab-h-title">{h.title}</span>
                        <span className="cab-h-price">{h.price} BYN</span>
                        <span className="cab-h-status">Оплачено</span>
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
                    <p>Управление аккаунтом</p>
                  </div>
                </header>

                <section className="cab-panel cab-set-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">01 · Профиль</span>
                    {!profileDraft && (
                      <button type="button" className="cab-btn cab-btn--line" onClick={startProfileEdit}>
                        Редактировать <Icon d={ICONS.edit} />
                      </button>
                    )}
                  </header>
                  {!profileDraft ? (
                    <dl className="cab-set-grid">
                      <div className="cab-set-item">
                        <dt>Имя</dt>
                        <dd>{profileName}</dd>
                      </div>
                      <div className="cab-set-item">
                        <dt>Телефон</dt>
                        <dd>{data.phone}</dd>
                      </div>
                      <div className="cab-set-item">
                        <dt>Класс</dt>
                        <dd>{profileSaved.klass ? `${profileSaved.klass} класс` : '—'}</dd>
                      </div>
                      <div className="cab-set-item cab-set-item--wide">
                        <dt>Цель обучения</dt>
                        <dd>{profileSaved.goal}</dd>
                      </div>
                    </dl>
                  ) : (
                    <form
                      className="cab-set-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setProfileSaved(profileDraft);
                        setProfileDraft(null);
                      }}
                    >
                      <label className="cab-set-field">
                        <span>Имя</span>
                        <input value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="Имя и фамилия" />
                      </label>
                      <label className="cab-set-field">
                        <span>Телефон</span>
                        <input value={data.phone} disabled />
                      </label>
                      <label className="cab-set-field">
                        <span>Класс</span>
                        <select value={profileDraft.klass} onChange={(e) => setProfileDraft({ ...profileDraft, klass: e.target.value })}>
                          {GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g} класс
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cab-set-field cab-set-field--wide">
                        <span>Цель обучения</span>
                        <select value={profileDraft.goal} onChange={(e) => setProfileDraft({ ...profileDraft, goal: e.target.value })}>
                          {STUDY_GOALS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="cab-set-actions">
                        <button type="button" className="cab-btn cab-btn--line" onClick={() => setProfileDraft(null)}>
                          Отмена
                        </button>
                        <button type="submit" className="cab-btn cab-btn--join">
                          Сохранить
                        </button>
                      </div>
                      <p className="cab-note cab-set-note">Телефон изменить нельзя — это твой вход в кабинет.</p>
                    </form>
                  )}
                </section>

                <section className="cab-panel cab-set-block">
                  <header className="cab-set-head">
                    <span className="cab-set-num">02 · Аккаунт</span>
                  </header>
                  <dl className="cab-set-grid">
                    <div className="cab-set-item">
                      <dt>ID ученика</dt>
                      <dd className="cab-set-mono">{studentId}</dd>
                    </div>
                    <div className="cab-set-item">
                      <dt>Дата регистрации</dt>
                      <dd>{formatDate(data.createdAt)}</dd>
                    </div>
                  </dl>
                  <div className="cab-set-danger">
                    <button type="button" className="cab-btn cab-btn--danger" onClick={handleSignOut} disabled={signingOut}>
                      {signingOut ? 'Выходим…' : 'Выйти из аккаунта'}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </main>

          <aside className="cab-aside">
            <section className="cab-panel cab-profile">
              <header className="cab-panel-head">
                <h3>Профиль</h3>
                <button type="button" className="cab-edit" onClick={() => setSection('settings')}>
                  Редактировать <Icon d={ICONS.edit} />
                </button>
              </header>
              <div className="cab-profile-row">
                <span className="cab-avatar-lg">{initials(displayName)}</span>
                <div className="cab-profile-id">
                  <strong>{displayName}</strong>
                  <span>{DEMO_PROFILE.sub}</span>
                  <span className="cab-profile-mail">{data.phone}</span>
                </div>
              </div>
              <div className="cab-stats">
                <div>
                  <span>Уровень</span>
                  <strong>{DEMO_PROFILE.level}</strong>
                </div>
                <div>
                  <span>Цель</span>
                  <strong>{DEMO_PROFILE.goal}</strong>
                </div>
                <div>
                  <span>В системе</span>
                  <strong>{days} дней</strong>
                </div>
              </div>
            </section>

            <a className="cab-panel cab-curator-card" href={tgBotUrl(contactIsMentor ? 'mentor' : 'curator')} target="_blank" rel="noopener noreferrer">
              <span className="cab-curator-ico">
                <Icon d={ICONS.send} />
              </span>
              <div className="cab-curator-text">
                <span className="cab-k">{contactIsMentor ? 'Связь с наставником' : 'Связь с куратором'}</span>
                <strong>{contactIsMentor ? teacherName : curator?.name ?? 'Написать в Telegram'}</strong>
                <span className="cab-curator-cta">
                  Перейти в TG <Icon d={ICONS.chevron} />
                </span>
              </div>
              <Icon d={ICONS.chevron} className="cab-curator-chev" />
            </a>

            <section className="cab-panel cab-achieve-panel">
              <header className="cab-panel-head">
                <h3>Достижения</h3>
                <span className="cab-panel-hint">
                  {DEMO_ACHIEVEMENTS.filter((a) => a.unlocked).length} из {DEMO_ACHIEVEMENTS.length}
                </span>
              </header>
              {/* 2 достижения в столбик, остальные — горизонтальной прокруткой */}
              <div className="cab-achieve">
                {DEMO_ACHIEVEMENTS.map((a) => (
                  <div key={a.id} className={`cab-ach${a.unlocked ? ' is-unlocked' : ''}`}>
                    <span className="cab-badge-hex">
                      <Icon d={ICONS[a.icon]} />
                    </span>
                    <span className="cab-ach-text">
                      <strong>{a.title}</strong>
                      <em>{a.sub}</em>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="cab-panel cab-help">
              <div className="cab-help-text">
                <h3>Нужна помощь?</h3>
                <p>Мы рядом!</p>
                <a className="cab-btn cab-btn--line" href={tgBotUrl('support')} target="_blank" rel="noopener noreferrer">
                  Написать в поддержку <Icon d={ICONS.chevron} />
                </a>
              </div>
              <Icon d={ICONS.support} className="cab-help-ico" />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
