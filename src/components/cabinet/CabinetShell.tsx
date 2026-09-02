'use client';

import { useEffect, useRef, useState } from 'react';
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

const DEMO_ACTIVITY = [
  { id: 'e1', icon: 'play', text: 'Вебинар «Алгебра»', date: '08.03.2024', status: 'Просмотрено', tone: 'ok' },
  { id: 'e2', icon: 'file', text: 'Домашнее задание', date: '09.03.2024', status: 'Проверено', tone: 'ok' },
  { id: 'e3', icon: 'play', text: 'Вебинар «Геометрия»', date: '15.03.2024', status: 'В процессе', tone: 'now' },
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

const DEMO_NEXT_LESSON = { day: '24', month: 'Сентября', weekday: 'Вторник', time: '18:30', duration: '60 минут', topic: 'Квадратные уравнения' };

/* Главная: блоки записи на форматы занятий (без цен) и преимущества. */
const SHOP_ITEMS = [
  { id: 'course', icon: 'course', title: 'Запись на курс', text: '74 занятия в 7 модулях: от диагностики до пробного экзамена.', href: '/cabinet/checkout?product=course', cta: 'Записаться' },
  { id: 'individual', icon: 'individual', title: 'Запись на индивидуальные', text: 'Занятия 1-на-1 с преподавателем под твою цель и график.', href: '/cabinet/checkout?product=individual', cta: 'Записаться' },
  { id: 'group', icon: 'users', title: 'Запись на групповые', text: 'Мини-группы: живое общение, разбор задач и мотивация.', href: '/cabinet/checkout?product=group', cta: 'Записаться' },
];

const PERKS = [
  { icon: 'play', title: 'Живые занятия', text: 'Вебинары и встречи с разбором задач в реальном времени.' },
  { icon: 'homework', title: 'Проверка домашек', text: 'Преподаватель проверяет и даёт обратную связь по каждой работе.' },
  { icon: 'target', title: 'Личный план', text: 'Программа строится под твой уровень и цель.' },
  { icon: 'trophy', title: 'Прогресс виден', text: 'Путь курса, достижения и статистика — всё в одном кабинете.' },
];

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

const NAV_ITEMS = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'lessons', label: 'Занятия', icon: 'course' },
  { id: 'homework', label: 'Домашние задания', icon: 'homework' },
  { id: 'payments', label: 'Платежи', icon: 'payments' },
  { id: 'notifications', label: 'Уведомления', icon: 'bell', badge: 3 },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
] as const;

type SectionId = (typeof NAV_ITEMS)[number]['id'];

const SUPPORT_EMAIL = 'district.school.210@gmail.com';

/* Ссылка на ТГ-бота: открывает чат с ботом и стартовым сообщением. */
function tgBotUrl(start: string): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return username ? `https://t.me/${username}?start=${start}` : `mailto:${SUPPORT_EMAIL}`;
}

const PRODUCT_LABELS: Record<string, string> = {
  course: 'Курс',
  individual: 'Индивидуальные',
  group: 'Группа',
};

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
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/* ---------------------------- Путь курса (дорога с остановками) ---------- */

const RM_STEP_X = 158;
const RM_LEFT = 140;
const RM_MID = 235;
const RM_AMP = 60;
const RM_GAP = 130; // физический разрыв дороги между кварталами-модулями
const RM_CANVAS_H = 470;

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

/* Каждый прогон — отдельный участок от остановки до остановки:
   живая извилистость чередующимися дугами вверх/вниз, шаг чуть растянут. */
function rmSegRoad(i: number): string {
  const a = RM_PTS[i];
  const b = RM_PTS[i + 1];
  const dx = b.x - a.x;
  const kind = i % 4;
  let mid: RmPt[];
  if (kind === 0) {
    mid = [
      { x: a.x + dx * 0.3, y: a.y - 40 },
      { x: a.x + dx * 0.72, y: b.y + 38 },
    ];
  } else if (kind === 1) {
    mid = [
      { x: a.x + dx * 0.5, y: a.y - 48 },
      { x: a.x + dx * 0.62, y: b.y + 42 },
    ];
  } else if (kind === 2) {
    mid = [
      { x: a.x + dx * 0.34, y: a.y + 36 },
      { x: a.x + dx * 0.68, y: b.y - 38 },
    ];
  } else {
    mid = [
      { x: a.x + dx * 0.42, y: a.y + 46 },
      { x: a.x + dx * 0.7, y: b.y - 42 },
    ];
  }
  return rmSpline([a, ...mid, b]);
}

const RM_SEG_ROADS: string[] = DEMO_STOPS.slice(0, -1).map((_, i) => rmSegRoad(i));

/* Старт пути: дорога начинается здесь и заканчивается первой остановкой. */
const RM_START: RmPt = { x: 46, y: RM_PTS[0].y + 64 };
const RM_START_ROAD = rmSpline([RM_START, { x: RM_PTS[0].x - 52, y: RM_PTS[0].y + 30 }, RM_PTS[0]]);

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
  const nowIndex = DEMO_STOPS.findIndex((s) => s.status === 'now');
  const last = RM_PTS[RM_PTS.length - 1];

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
      <div className="cab-roadmap-bg" aria-hidden="true" />
      <div className="cab-roadmap" ref={wrapRef} aria-label="Путь по курсу">
        <div className="cab-roadmap-canvas" style={{ width: RM_CANVAS_W }}>
          <svg className="cab-roadmap-svg" width={RM_CANVAS_W} height={RM_CANVAS_H} aria-hidden="true">
            {/* прогон от старта до первой остановки */}
            <g>
              <path d={RM_START_ROAD} fill="none" stroke="#0e1730" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" />
              <path d={RM_START_ROAD} fill="none" stroke="#223052" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
              <path d={RM_START_ROAD} fill="none" stroke="#1a2440" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
              <path d={RM_START_ROAD} fill="none" stroke={DEMO_MODULES[0].color} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" opacity={nowIndex >= 0 ? 0.85 : 0.05} style={nowIndex >= 0 ? { filter: `drop-shadow(0 0 10px ${DEMO_MODULES[0].color})` } : undefined} />
              <path d={RM_START_ROAD} fill="none" stroke="rgba(240, 246, 255, 0.55)" strokeWidth="2.5" strokeDasharray="14 20" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px rgba(120, 220, 255, 0.4))' }} />
            </g>
            {/* каждый прогон — отдельная улица от остановки до остановки */}
            {DEMO_STOPS.slice(0, -1).map((s, i) => {
              if (RM_MODULE_BREAK.has(i)) return null;
              const color = DEMO_MODULES[s.module].color;
              const passed = i < nowIndex;
              const road = RM_SEG_ROADS[i];
              return (
                <g key={i}>
                  <path d={road} fill="none" stroke="#0e1730" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={road} fill="none" stroke="#223052" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={road} fill="none" stroke="#1a2440" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
                  <path
                    d={road}
                    fill="none"
                    stroke={color}
                    strokeWidth="26"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={passed ? 0.85 : 0.05}
                    style={passed ? { filter: `drop-shadow(0 0 10px ${color})` } : undefined}
                  />
                  <path d={road} fill="none" stroke="rgba(240, 246, 255, 0.55)" strokeWidth="2.5" strokeDasharray="14 20" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px rgba(120, 220, 255, 0.4))' }} />
                </g>
              );
            })}
            {/* площадки-остановки: дорога заканчивается на площадке, а не проходит сквозь */}
            {RM_PTS.map((p, i) => {
              const st = DEMO_STOPS[i];
              const passed = st.status === 'watched' || st.status === 'done';
              const color = DEMO_MODULES[st.module].color;
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r="19" className="cab-rm-plaza" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="19"
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    opacity={passed ? 0.8 : 0.12}
                    style={passed ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
                  />
                </g>
              );
            })}
            {/* точка старта */}
            <circle cx={RM_START.x} cy={RM_START.y} r="13" className="cab-rm-start-bg" />
            <text x={RM_START.x} y={RM_START.y + 32} textAnchor="middle" className="cab-rm-start-label">СТАРТ</text>
            {/* граница кварталов: разрыв дороги со столбиками и ромбом-знаком */}
            {[...RM_MODULE_BREAK].map((i) => {
              const a = RM_PTS[i];
              const b = RM_PTS[i + 1];
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={i} opacity="0.65">
                  <path d={rmBreakPath(i)} fill="none" stroke="#3d4f7c" strokeWidth="2.5" strokeDasharray="3 9" strokeLinecap="round" />
                  <line x1={a.x + 30} y1={a.y - 15} x2={a.x + 30} y2={a.y + 15} stroke="#3d4f7c" strokeWidth="2" strokeLinecap="round" />
                  <line x1={b.x - 30} y1={b.y - 15} x2={b.x - 30} y2={b.y + 15} stroke="#3d4f7c" strokeWidth="2" strokeLinecap="round" />
                  <path d={`M ${mx} ${my - 6} l 6 6 l -6 6 l -6 -6 z`} fill="rgba(90, 111, 158, 0.15)" stroke="#5a6f9e" strokeWidth="1.5" />
                </g>
              );
            })}
            {/* фонари вдоль улицы */}
            {RM_PTS.filter((_, i) => i % 4 === 2).map((p, li) => (
              <g key={li}>
                <line x1={p.x + 24} y1={p.y + 2} x2={p.x + 24} y2={p.y - 28} stroke="#2a3a5f" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx={p.x + 24} cy={p.y - 30} r="3.5" fill="#ffd9a8" opacity="0.95" style={{ filter: 'drop-shadow(0 0 9px rgba(255, 217, 168, 0.95))' }} />
              </g>
            ))}
            {/* декоративные ответвления-тупики */}
            {[8, 31, 55].map((i) => {
              const p = RM_PTS[i];
              const dy = i % 2 === 0 ? -46 : 46;
              return (
                <g key={i} opacity="0.55">
                  <path d={`M ${p.x} ${p.y} q ${i % 2 === 0 ? 26 : 30} ${dy * 0.9} 66 ${dy}`} fill="none" stroke="#26345c" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
                  <circle cx={p.x + 66} cy={p.y + dy} r="5" fill="none" stroke="#26345c" strokeWidth="3" />
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
            const color = DEMO_MODULES[s.module].color;
            const p = RM_PTS[i];
            const label = stopLabel(s.status);
            return (
              <div
                key={s.id}
                data-stop={s.id}
                className={`cab-rm-stop is-${s.status} kind-${s.kind}${selected === s.id ? ' is-selected' : ''}${i % 2 === 0 ? ' plate-top' : ' plate-bottom'}`}
                style={{
                  left: p.x,
                  top: p.y,
                  ['--stop-color' as string]: color,
                  ['--stop-glow' as string]: `${color}59`,
                  ['--stop-soft' as string]: `${color}14`,
                }}
              >
                <span className="cab-rm-stem" aria-hidden="true" />
                <button
                  type="button"
                  className="cab-rm-node"
                  onClick={() => onSelect(s.id)}
                  disabled={s.status === 'locked'}
                  title={label}
                  aria-label={`${label}: ${s.title}`}
                >
                  <Icon d={s.status === 'locked' ? ICONS.lock : s.kind === 'milestone' ? ICONS.trophy : s.kind === 'practice' ? ICONS.flask : ICONS.screen} />
                  {s.status === 'watched' && (
                    <span className="cab-rm-checked">
                      <Icon d={ICONS.check} />
                    </span>
                  )}
                  {s.status === 'now' && <span className="cab-rm-ping" aria-hidden="true" />}
                </button>
                <button type="button" className="cab-rm-plate" onClick={() => onSelect(s.id)} disabled={s.status === 'locked'}>
                  <span className="cab-rm-sign" aria-hidden="true" />
                  <span className="cab-rm-plate-top">
                    <b>{`М${s.module + 1} · ${s.numInModule}`}</b>
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
    </div>
  );
}

function LivesWidget() {
  return (
    <div className="cab-lives" title="Твои жизни">
      <span className="cab-lives-hearts">
        {Array.from({ length: DEMO_LIVES.total }).map((_, i) => (
          <Heart key={i} filled={i < DEMO_LIVES.full} />
        ))}
      </span>
      <button type="button" className="cab-lives-plus" title="Восстановить жизни">
        <Icon d={ICONS.plus} />
      </button>
      <span className="cab-lives-timer">
        До восстановления: <b>{DEMO_LIVES.restore}</b>
      </span>
    </div>
  );
}

function Panel({ title, hint, extra, children }: { title: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cab-panel">
      <header className="cab-panel-head">
        <h3>{title}</h3>
        {hint ? <span className="cab-panel-hint">{hint}</span> : null}
        {extra}
      </header>
      {children}
    </section>
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
  const [section, setSection] = useState<SectionId>('home');
  const [mode, setMode] = useState<CabinetMode>('course');
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [stopId, setStopId] = useState<number>(DEMO_STOPS.find((s) => s.status === 'now')?.id ?? 1);
  const [indLessonId, setIndLessonId] = useState<string>(DEMO_IND_LESSONS[0].id);

  const displayName = data.studentName ?? DEMO_PROFILE.name; // TEMP: демо-имя, пока нет реального
  const days = daysInSystem(data.createdAt);
  const curator = data.mentors.find((m) => m.kind === 'curator') ?? null;
  const teacher = data.mentors.find((m) => m.kind === 'teacher') ?? null;
  const teacherName = teacher?.name ?? 'Кристина Денисовна'; // TEMP: демо-имя, пока нет реального
  const contactIsMentor = section === 'lessons' && mode === 'individual';

  const stop = DEMO_STOPS.find((s) => s.id === stopId) ?? DEMO_STOPS[0];
  const stopModule = DEMO_MODULES[stop.module];
  const indLesson = DEMO_IND_LESSONS.find((l) => l.id === indLessonId) ?? DEMO_IND_LESSONS[0];

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
          {NAV_ITEMS.map((item) => (
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
              {'badge' in item && item.badge ? <span className="cab-nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>
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
                  Кабинет индивидуальных занятий
                </button>
              </div>
            )}

            {section === 'home' && (
              <div className="cab-stack">
                <section className="cab-panel cab-hello">
                  <h2>{`С возвращением, ${displayName.split(' ')[0]}!`}</h2>
                  <p>Выбирай формат обучения — и продолжай свой путь к результату.</p>
                  <div className="cab-chips">
                    {data.accesses.length === 0 && <span className="cab-chip">Доступы появятся после оплаты</span>}
                    {data.accesses.map((a, i) => (
                      <span key={`${a.product}-${i}`} className="cab-chip">
                        {PRODUCT_LABELS[a.product] ?? a.product} · до {formatDate(a.expiresAt)}
                      </span>
                    ))}
                  </div>
                </section>
                <div className="cab-shop">
                  {SHOP_ITEMS.map((s) => (
                    <a key={s.id} className="cab-shop-card" href={s.href}>
                      <span className="cab-shop-ico">
                        <Icon d={ICONS[s.icon]} />
                      </span>
                      <strong>{s.title}</strong>
                      <span className="cab-shop-text">{s.text}</span>
                      <span className="cab-shop-cta">
                        {s.cta} <Icon d={ICONS.chevron} />
                      </span>
                    </a>
                  ))}
                </div>
                <section className="cab-panel">
                  <header className="cab-panel-head">
                    <h3>Почему занимаются в District</h3>
                  </header>
                  <div className="cab-perks">
                    {PERKS.map((p) => (
                      <div key={p.title} className="cab-perk">
                        <span className="cab-perk-ico">
                          <Icon d={ICONS[p.icon]} />
                        </span>
                        <div className="cab-perk-text">
                          <strong>{p.title}</strong>
                          <span>{p.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {section === 'lessons' && mode === 'course' && (
              <div className="cab-stack">
                <section className="cab-panel cab-path-panel">
                  <header className="cab-panel-head">
                    <h3>Твой путь по курсу</h3>
                    <LivesWidget />
                    <span className="cab-progress">
                      Общий прогресс <b>{DEMO_PROGRESS}%</b>
                    </span>
                  </header>
                  <CourseMap selected={stopId} onSelect={setStopId} />
                  <div className="cab-mods">
                    {DEMO_MODULES.map((m, mi) => (
                      <span key={m.name} className="cab-mod">
                        <i style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }} />
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

                <section className="cab-panel">
                  <header className="cab-panel-head">
                    <h3>Твои достижения</h3>
                  </header>
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
              </div>
            )}

            {section === 'lessons' && mode === 'individual' && (
              <div className="cab-stack">
                <div className="cab-ind-head">
                  <h2>Мои индивидуальные занятия</h2>
                  <p>Занимайся с преподавателем и достигай максимального результата</p>
                </div>

                <section className="cab-panel cab-ind-next">
                  <div className="cab-ind-next-grid">
                    <div className="cab-ind-date">
                      <strong>{DEMO_NEXT_LESSON.day}</strong>
                      <span>{DEMO_NEXT_LESSON.month}</span>
                      <em>{DEMO_NEXT_LESSON.weekday}</em>
                    </div>
                    <div className="cab-ind-time">
                      <strong>{DEMO_NEXT_LESSON.time}</strong>
                      <span>{DEMO_NEXT_LESSON.duration}</span>
                    </div>
                    <div className="cab-ind-topic">
                      <span className="cab-k">Тема занятия</span>
                      <strong>{DEMO_NEXT_LESSON.topic}</strong>
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
                  <button type="button" className="cab-btn cab-btn--line cab-ind-join">
                    Подключиться к занятию
                  </button>
                </section>

                <div className="cab-ind-grid">
                  <section className="cab-panel">
                    <header className="cab-panel-head">
                      <h3>Мои занятия</h3>
                      <span className="cab-panel-hint">выбери, чтобы увидеть материалы и домашку</span>
                    </header>
                    <div className="cab-ind-group">Предстоящие</div>
                    {DEMO_IND_LESSONS.filter((l) => l.status === 'upcoming').map((l) => (
                      <button key={l.id} type="button" className={`cab-ind-row${indLessonId === l.id ? ' is-selected' : ''}`} onClick={() => setIndLessonId(l.id)}>
                        <span className="cab-ind-cell-date">
                          {l.date} <em>{l.time}</em>
                        </span>
                        <span className="cab-ind-cell-topic">{l.topic}</span>
                        <span className={`cab-ind-kind is-${l.kind}`}>{l.kind === 'group' ? 'Группа' : '1-на-1'}</span>
                        <span className="cab-ind-status is-upcoming">Предстоит</span>
                        <Icon d={ICONS.chevron} className="cab-ind-chev" />
                      </button>
                    ))}
                    <div className="cab-ind-group">Завершённые</div>
                    {DEMO_IND_LESSONS.filter((l) => l.status === 'done').map((l) => (
                      <button key={l.id} type="button" className={`cab-ind-row${indLessonId === l.id ? ' is-selected' : ''}`} onClick={() => setIndLessonId(l.id)}>
                        <span className="cab-ind-cell-date">
                          {l.date} <em>{l.time}</em>
                        </span>
                        <span className="cab-ind-cell-topic">{l.topic}</span>
                        <span className={`cab-ind-kind is-${l.kind}`}>{l.kind === 'group' ? 'Группа' : '1-на-1'}</span>
                        <span className="cab-ind-status is-done">Завершено</span>
                        <Icon d={ICONS.chevron} className="cab-ind-chev" />
                      </button>
                    ))}
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
                        {indLesson.homework && <span className={`cab-ind-status is-${indLesson.homework.tone === 'ok' ? 'done' : 'now'}`}>{indLesson.homework.state}</span>}
                      </header>
                      {indLesson.homework ? (
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
                        <p className="cab-note">Домашка появится после занятия — её загрузит преподаватель.</p>
                      )}
                    </section>
                  </div>
                </div>
              </div>
            )}

            {section === 'homework' && (
              <Panel title="Домашние задания">
                <ComingSoon text="Задания, проверки и комментарии преподавателя появятся здесь, когда модуль будет подключён к базе." />
              </Panel>
            )}

            {section === 'payments' && (
              <Panel title="Платежи" hint="история покупок">
                {data.accesses.length === 0 ? (
                  <ComingSoon text="Пока нет активных покупок. После оплаты здесь появится история платежей и чеки." />
                ) : (
                  <ul className="cab-list">
                    {data.accesses.map((a, i) => (
                      <li key={`${a.product}-${i}`}>
                        <span>{PRODUCT_LABELS[a.product] ?? a.product}</span>
                        <span className="cab-list-meta">до {formatDate(a.expiresAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {section === 'notifications' && (
              <Panel title="Уведомления">
                <ComingSoon text="Уведомления о вебинарах, проверках и новостях школы появятся здесь." />
              </Panel>
            )}

            {section === 'settings' && (
              <div className="cab-stack">
                <Panel title="Профиль">
                  <dl className="cab-defs">
                    <div>
                      <dt>Имя</dt>
                      <dd>{data.studentName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Телефон</dt>
                      <dd>{data.phone}</dd>
                    </div>
                    <div>
                      <dt>В системе с</dt>
                      <dd>{formatDate(data.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Telegram</dt>
                      <dd>{data.telegramLinked ? 'Подключён' : 'Не подключён'}</dd>
                    </div>
                  </dl>
                  <p className="cab-note">Имя и класс синхронизируются с Telegram-ботом школы.</p>
                </Panel>
                <Panel title="Выход">
                  <button type="button" className="cab-btn cab-btn--danger" onClick={handleSignOut} disabled={signingOut}>
                    {signingOut ? 'Выходим…' : 'Выйти из аккаунта'}
                  </button>
                </Panel>
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

            <section className="cab-panel cab-activity">
              <header className="cab-panel-head">
                <h3>Активность</h3>
              </header>
              <ul>
                {DEMO_ACTIVITY.map((e) => (
                  <li key={e.id}>
                    <Icon d={ICONS[e.icon]} className="cab-act-ico" />
                    <span className="cab-act-text">{e.text}</span>
                    <span className="cab-act-date">{e.date}</span>
                    <span className={`cab-act-status is-${e.tone}`}>{e.status}</span>
                  </li>
                ))}
              </ul>
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
