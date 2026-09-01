'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CabinetData, CabinetMode } from '@/lib/cabinet';

/* -------------------------------------------------------------------------- */
/* ВРЕМЕННЫЕ ДЕМО-ДАННЫЕ ДЛЯ ПРЕВЬЮ ИНТЕРФЕЙСА.                               */
/* Реальных таблиц вебинаров/достижений/активности пока нет —                 */
/* при их появлении заменить эти константы на данные из Supabase.             */
/* -------------------------------------------------------------------------- */

type WebinarStatus = 'done' | 'now' | 'locked';

type DemoWebinar = {
  id: number;
  num: string;
  title: string;
  date: string;
  status: WebinarStatus;
  about: string;
  watched: string;
  duration: string;
  watchedPercent: number;
  checks: { label: string; done: boolean }[];
  files: { name: string; size: string }[];
};

const DEMO_FILES = [
  { name: 'Презентация.pdf', size: '2.4 MB' },
  { name: 'Конспект.docx', size: '1.1 MB' },
  { name: 'Задачи.pdf', size: '3.7 MB' },
];

const DEMO_WEBINARS: DemoWebinar[] = [
  {
    id: 1, num: '01', title: 'Диагностика', date: '01.03.2024', status: 'done',
    about: 'Входная диагностика: определяем стартовый уровень, сильные стороны и пробелы. Составляем личный план подготовки.',
    watched: '46:02', duration: '46:30', watchedPercent: 96,
    checks: [
      { label: 'Теория', done: true },
      { label: 'Разбор задач', done: true },
      { label: 'Практика', done: true },
      { label: 'Домашнее задание', done: true },
    ],
    files: DEMO_FILES,
  },
  {
    id: 2, num: '02', title: 'Алгебра', date: '08.03.2024', status: 'done',
    about: 'Уравнения и неравенства: методы решения, тождественные преобразования, разбор типовых задач экзамена.',
    watched: '1:10:24', duration: '1:12:40', watchedPercent: 97,
    checks: [
      { label: 'Теория', done: true },
      { label: 'Разбор задач', done: true },
      { label: 'Практика', done: true },
      { label: 'Домашнее задание', done: true },
    ],
    files: DEMO_FILES,
  },
  {
    id: 3, num: '03', title: 'Геометрия', date: '15.03.2024', status: 'now',
    about: 'Планиметрия: треугольники, окружности, четырёхугольники. Основные теоремы и задачи.',
    watched: '42:15', duration: '1:28:40', watchedPercent: 48,
    checks: [
      { label: 'Теория', done: true },
      { label: 'Разбор задач', done: true },
      { label: 'Практика', done: true },
      { label: 'Домашнее задание', done: false },
    ],
    files: DEMO_FILES,
  },
  {
    id: 4, num: '04', title: 'Теория чисел', date: '22.03.2024', status: 'locked',
    about: 'Делимость, НОД и НОК, сравнения и олимпиадные приёмы. Вебинар откроется после текущего модуля.',
    watched: '00:00', duration: '1:20:00', watchedPercent: 0,
    checks: [
      { label: 'Теория', done: false },
      { label: 'Разбор задач', done: false },
      { label: 'Практика', done: false },
      { label: 'Домашнее задание', done: false },
    ],
    files: DEMO_FILES,
  },
  {
    id: 5, num: '05', title: 'Экзамен', date: '29.03.2024', status: 'locked',
    about: 'Итоговый пробный экзамен в формате ЦТ/ЕГЭ: тайминг, стратегия решения и разбор ловушек.',
    watched: '00:00', duration: '2:00:00', watchedPercent: 0,
    checks: [
      { label: 'Теория', done: false },
      { label: 'Разбор задач', done: false },
      { label: 'Практика', done: false },
      { label: 'Домашнее задание', done: false },
    ],
    files: DEMO_FILES,
  },
];

const DEMO_PROGRESS = 37;
const DEMO_LIVES = { full: 2, total: 3, restore: '12:45:32' };

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

/* Временные данные профиля для превью (заменить реальными). */
const DEMO_PROFILE = { name: 'Иван Петров', sub: 'Ученик 10 класса', email: 'ivan.petrov@example.com', level: '10 класс', goal: '90+ баллов' };

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
  edit: 'M4 20h4L20 8l-4-4L4 16v4z M13 6l4 4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3.5 2',
  burger: 'M4 7h16 M4 12h16 M4 17h16',
  plus: 'M12 5v14 M5 12h14',
  rocket: 'M12 2c3 2 5 6 5 10l3 4-4-1a8 8 0 0 1-8 0l-4 1 3-4c0-4 2-8 5-10z M12 9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z M9 19l-1.5 3 M15 19l1.5 3',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  pin: 'M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z M12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  expand: 'M8 3H3v5 M16 3h5v5 M8 21H3v-5 M16 21h5v-5',
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
  { id: 'course', label: 'Курс', icon: 'course' },
  { id: 'individual', label: 'Индивидуальные занятия', icon: 'individual' },
  { id: 'homework', label: 'Домашние задания', icon: 'homework' },
  { id: 'results', label: 'Результаты', icon: 'results' },
  { id: 'payments', label: 'Платежи', icon: 'payments' },
  { id: 'notifications', label: 'Уведомления', icon: 'bell', badge: 3 },
  { id: 'support', label: 'Поддержка', icon: 'support' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
] as const;

type SectionId = (typeof NAV_ITEMS)[number]['id'];

const SUPPORT_EMAIL = 'district.school.210@gmail.com';

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

/* Дорога курса: узлы лежат на концах сегментов кубической кривой. */
const ROAD_D =
  'M 20 165 C 60 165 70 150 100 150 C 160 150 200 95 266 95 C 330 95 370 150 433 150 C 500 150 540 95 600 95 C 660 95 700 150 766 150 C 830 150 880 110 930 110';

const ROAD_NODES = [
  { x: 100, y: 150 },
  { x: 266, y: 95 },
  { x: 433, y: 150 },
  { x: 600, y: 95 },
  { x: 766, y: 150 },
  { x: 930, y: 110 },
];

function CourseRoad() {
  return (
    <svg viewBox="0 0 1000 200" className="cab-road" preserveAspectRatio="none" aria-hidden="true">
      {/* серая трасса впереди */}
      <path d={ROAD_D} pathLength={100} className="cab-road-base" fill="none" />
      {/* пройденный участок — неон cyan */}
      <path d={ROAD_D} pathLength={100} className="cab-road-done" fill="none" strokeDasharray="45 55" />
      {/* текущий отрезок — оранжевый пунктир */}
      <path d={ROAD_D} pathLength={100} className="cab-road-now" fill="none" strokeDasharray="24 76" strokeDashoffset="-45" />
      {/* дорожная разметка поверх трассы */}
      <path d={ROAD_D} className="cab-road-marks" fill="none" />
      {ROAD_NODES.map((n, i) => {
        const w = DEMO_WEBINARS[i];
        const state = i < 5 ? w.status : 'finish';
        return (
          <g key={i} transform={`translate(${n.x} ${n.y})`}>
            {state === 'done' && (
              <>
                <circle r="11" className="cab-node-done" />
                <path d="M-4.5 0 -1.5 3.5 5 -4" className="cab-node-check" fill="none" />
              </>
            )}
            {state === 'now' && (
              <>
                <circle r="12" className="cab-node-now-halo" />
                <circle r="6" className="cab-node-now" />
              </>
            )}
            {state === 'locked' && (
              <>
                <circle r="10" className="cab-node-locked" />
                <path d="M-3 -1h6v5h-6z M-2 -1v-1.6a2 2 0 0 1 4 0V-1" className="cab-node-lock" fill="none" />
              </>
            )}
            {state === 'finish' && (
              <>
                <circle r="12" className="cab-node-finish" />
                <path d={ICONS.trophy} className="cab-node-trophy" fill="none" transform="translate(-8 -8) scale(0.68)" />
              </>
            )}
          </g>
        );
      })}
    </svg>
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

function Panel({ title, hint, extra, children, className }: { title: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`cab-panel${className ? ` ${className}` : ''}`}>
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
  const [webinarId, setWebinarId] = useState<number>(DEMO_WEBINARS.find((w) => w.status === 'now')?.id ?? 1);

  const displayName = data.studentName ?? DEMO_PROFILE.name; // TEMP: демо-имя, пока нет реального
  const days = daysInSystem(data.createdAt);
  const curator = data.mentors.find((m) => m.kind === 'curator') ?? null;
  const teacher = data.mentors.find((m) => m.kind === 'teacher') ?? null;
  const webinar = DEMO_WEBINARS.find((w) => w.id === webinarId) ?? DEMO_WEBINARS[0];

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  const sectionTitle = NAV_ITEMS.find((n) => n.id === section)?.label ?? 'Главная';
  const showTabs = section === 'course' || section === 'individual';

  return (
    <div className="cabinet">
      <div className={`cab-backdrop${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`cab-sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="cab-brand">
          <span className="logo-icon" aria-hidden="true" />
          <span className="cab-brand-name">District</span>
        </div>
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
          <div>
            <h1>Личный кабинет</h1>
            <p>Твоё обучение. Твой прогресс. Твой результат.</p>
          </div>
        </header>

        <div className="cab-body">
          <main className="cab-content">
            {showTabs && (
              <div className="cab-tabs" role="tablist" aria-label="Режим кабинета">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'course'}
                  className={`cab-tab${mode === 'course' ? ' is-active' : ''}`}
                  onClick={() => {
                    setMode('course');
                    setSection('course');
                  }}
                >
                  Кабинет курса
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'individual'}
                  className={`cab-tab${mode === 'individual' ? ' is-active' : ''}`}
                  onClick={() => {
                    setMode('individual');
                    setSection('individual');
                  }}
                >
                  Кабинет индивидуальных занятий
                </button>
              </div>
            )}

            {section === 'home' && (
              <div className="cab-stack">
                <Panel title={`С возвращением, ${displayName.split(' ')[0]}!`}>
                  <div className="cab-home-grid">
                    <div className="cab-home-card">
                      <span className="cab-home-k">Курс</span>
                      <strong>{data.enrollment?.courseTitle ?? 'Курс не подключён'}</strong>
                      <span className="cab-home-note">
                        {data.enrollment ? `В группе: ${data.group?.title ?? 'набор идёт'}` : 'Оформляется после оплаты'}
                      </span>
                    </div>
                    <div className="cab-home-card">
                      <span className="cab-home-k">Индивидуальные</span>
                      <strong>{teacher ? teacher.name : 'Занятия 1-на-1'}</strong>
                      <span className="cab-home-note">{teacher ? 'Преподаватель назначен' : 'Преподаватель появится после записи'}</span>
                    </div>
                  </div>
                  <div className="cab-chips">
                    {data.accesses.length === 0 && <span className="cab-chip">Доступы появятся после оплаты</span>}
                    {data.accesses.map((a, i) => (
                      <span key={`${a.product}-${i}`} className="cab-chip">
                        {PRODUCT_LABELS[a.product] ?? a.product} · до {formatDate(a.expiresAt)}
                      </span>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {section === 'course' && mode === 'course' && (
              <div className="cab-stack">
                {/* Путь по курсу: миссии-вебинары + дорога */}
                <section className="cab-panel cab-path-panel">
                  <header className="cab-panel-head">
                    <h3>Твой путь по курсу</h3>
                    <LivesWidget />
                    <span className="cab-progress">
                      Общий прогресс <b>{DEMO_PROGRESS}%</b>
                    </span>
                  </header>
                  <div className="cab-missions">
                    {DEMO_WEBINARS.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        disabled={w.status === 'locked'}
                        className={`cab-mission is-${w.status}${webinarId === w.id ? ' is-selected' : ''}`}
                        onClick={() => setWebinarId(w.id)}
                      >
                        <span className="cab-mission-num">{w.num}</span>
                        <span className="cab-mission-title">{w.title}</span>
                        <span className="cab-mission-kind">Вебинар</span>
                        <span className="cab-mission-date">{w.date}</span>
                        <span className="cab-mission-ico">
                          <Icon d={w.status === 'done' ? ICONS.check : w.status === 'now' ? ICONS.pin : ICONS.lock} />
                        </span>
                      </button>
                    ))}
                    <div className="cab-finish">
                      <span className="cab-finish-k">FINISH</span>
                      <strong>Результат</strong>
                      <span className="cab-finish-note">Твой личный балл</span>
                      <span className="cab-finish-ico">
                        <Icon d={ICONS.trophy} />
                      </span>
                    </div>
                  </div>
                  <CourseRoad />
                </section>

                {/* Инфо по выбранному вебинару */}
                <section className="cab-panel cab-module-panel">
                  <header className="cab-panel-head">
                    <h3 className="cab-module-title">
                      {webinar.num} · {webinar.title}
                    </h3>
                    {webinar.status === 'now' && <span className="cab-badge-now">Сейчас</span>}
                  </header>
                  <div className="cab-module-grid">
                    <div className="cab-video">
                      <div className="cab-video-top">
                        <strong>{webinar.title}</strong>
                        <span>Вебинар от {webinar.date}</span>
                      </div>
                      <button type="button" className="cab-video-play" aria-label="Смотреть вебинар">
                        <Icon d={ICONS.play} />
                      </button>
                      <div className="cab-video-bar">
                        <i style={{ width: `${webinar.watchedPercent}%` }} />
                      </div>
                      <div className="cab-video-meta">
                        <span>
                          {webinar.watched} / {webinar.duration}
                        </span>
                        <Icon d={ICONS.expand} className="cab-video-expand" />
                      </div>
                    </div>
                    <div className="cab-about">
                      <h4>О чём вебинар</h4>
                      <p>{webinar.about}</p>
                      <ul className="cab-checks">
                        {webinar.checks.map((c) => (
                          <li key={c.label} className={c.done ? 'is-done' : ''}>
                            <span className="cab-check-ico">
                              {c.done ? <Icon d={ICONS.check} /> : <i />}
                            </span>
                            {c.label}
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="cab-btn cab-btn--orange">Открыть вебинар</button>
                    </div>
                    <div className="cab-files">
                      <h4>Файлы к вебинару</h4>
                      {webinar.files.map((f) => (
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

                {/* Достижения */}
                <section className="cab-panel cab-achieve-panel">
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

            {section === 'individual' && mode === 'individual' && (
              <div className="cab-stack">
                <Panel title="Индивидуальные занятия" hint="формат 1-на-1">
                  <dl className="cab-defs">
                    <div>
                      <dt>Преподаватель</dt>
                      <dd>{teacher ? teacher.name : 'Назначается после записи'}</dd>
                    </div>
                    <div>
                      <dt>Формат</dt>
                      <dd>Онлайн, 60 минут</dd>
                    </div>
                    <div>
                      <dt>Материалы</dt>
                      <dd>Конспекты и записи после каждого занятия</dd>
                    </div>
                  </dl>
                </Panel>
                <Panel title="Расписание и домашние задания">
                  <ComingSoon text="Расписание индивидуальных занятий и задания появятся здесь после первой записи." />
                </Panel>
              </div>
            )}

            {section === 'homework' && (
              <Panel title="Домашние задания">
                <ComingSoon text="Задания, проверки и комментарии преподавателя появятся здесь, когда модуль будет подключён к базе." />
              </Panel>
            )}

            {section === 'results' && (
              <Panel title="Результаты">
                <ComingSoon text="Баллы, статистика и динамика по тестам появятся здесь, когда модуль будет подключён к базе." />
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

            {section === 'support' && (
              <Panel title="Поддержка" hint="мы рядом">
                <div className="cab-support">
                  <p>Вопрос по обучению, оплате или расписанию? Напиши нам — ответим в Telegram или на почту.</p>
                  <div className="cab-support-actions">
                    <a className="cab-btn cab-btn--line" href="mailto:{SUPPORT_EMAIL}">
                      {SUPPORT_EMAIL}
                    </a>
                    {data.telegramLinked ? (
                      <span className="cab-note-ok">Telegram подключён — куратор на связи в чате школы</span>
                    ) : (
                      <span className="cab-note">Подключи Telegram, чтобы писать куратору в один клик</span>
                    )}
                  </div>
                </div>
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
                  <span className="cab-profile-mail">{DEMO_PROFILE.email}</span>
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

            <section className="cab-panel cab-curator-card">
              <span className="cab-curator-ico">
                <Icon d={ICONS.send} />
              </span>
              <div className="cab-curator-text">
                <span className="cab-k">Связь с куратором</span>
                {curator ? <strong>{curator.name}</strong> : <a href={`mailto:${SUPPORT_EMAIL}`}>Написать в Telegram</a>}
                <em>Задай вопрос куратору</em>
              </div>
              <Icon d={ICONS.chevron} className="cab-curator-chev" />
            </section>

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
                <a className="cab-btn cab-btn--line" href={`mailto:${SUPPORT_EMAIL}`}>
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
