'use client';

import { useEffect, useRef } from 'react';
import MainFaq from '@/components/ui/MainFaq';
import AtmosphereLayers from '@/components/ui/AtmosphereLayers';
import { useForm } from '@/contexts/FormContext';

// Платный курс пока не подключён: кнопка записи показывает сообщение
// и предлагает бесплатный пробный вебинар (Telegram).
const COURSE_UNAVAILABLE_NOTICE =
  'Запись на платный курс пока недоступна. Запишись на бесплатный пробный вебинар, чтобы познакомиться с форматом.';

const SPECS = [
  { label: 'Харизма и удержание внимания', value: 98 },
  { label: 'Взлом ЦТ / декодирование информации', value: 100 },
  { label: 'Ментальная стойкость', value: 95 },
  { label: 'Прокачка новичков', value: 92 },
  { label: 'Индекс занудства', value: 4 },
  { label: 'Синхронизация (понятный язык)', value: 99 },
];

const DATA_ITEMS = [
  {
    title: 'Год инициации в системе (опыт)',
    text: 'Преподавательский стаж 4 года',
  },
  {
    title: 'Базовый сектор подготовки (образование)',
    text: '2019 — лицей №2, физмат профиль\n2023 — БГУ, механико-математический факультет, специальность: математика [научно-педагогическая деятельность]',
  },
  {
    title: 'Главный боевой трофей (результат)',
    text: 'Личный результат: 98 баллов ЦТ',
  },
];

const PROGRAM_STEPS = [
  { title: 'Диагностика', text: 'Определяем уровень, цели и точки роста.' },
  { title: 'Личный план', text: 'Собираем программу под твои задачи.' },
  { title: 'Практика', text: 'Решаем реальные варианты ЕГЭ и олимпиад.' },
  { title: 'Контроль', text: 'Срезы, разбор ошибок и отчёты родителям.' },
  { title: 'Победа', text: 'Выходим на экзамен подготовленным на 100%.' },
];

const WAVE_BARS = Array.from({ length: 64 }, (_, i) => 18 + ((i * 53) % 82));

const INIT_STEPS = [
  {
    num: '01',
    icon: 'search',
    title: '8 занятий с экспертом',
    lines: [
      '2 раза в неделю',
      '1 занятие ~90 минут',
      'Разбор ловушек ЦТ в режиме реального времени',
      'Решаем только то, что реально будет на ЦТ',
    ],
  },
  {
    num: '02',
    icon: 'pencil',
    title: 'Ручная проверка домашних заданий',
    lines: [
      'Поддержка, мотивация и контроль 24/7',
      'Личный куратор в Telegram с развернутыми комментариями к домашнему заданию — он разбирает каждую твою ошибку',
    ],
  },
  {
    num: '03',
    icon: 'sliders',
    title: 'Доступ к интерактивной платформе',
    lines: ['Улица Дистрикта с визуализацией твоего прогресса'],
  },
  {
    num: '04',
    icon: 'chart',
    title: 'Оружейная комната',
    lines: ['Шпаргалки, чек-листы и материалы по всем темам ЦТ'],
  },
];

const RAID_PERKS = [
  'Программа строится под твою цель и стартовый уровень',
  'Гибкий график — занятия когда удобно, даже вечером',
  'Максимальное внимание наставника всё занятие',
  'Личный куратор и разбор каждой ошибки 24/7',
];

const SQUAD_PERKS = [
  'Цена ниже, качество подготовки то же',
  'Командный рейтинг и совместные квесты',
  'Игровая мотивация: уровни, лиги, награды',
  'Занятия в мини-группе до 5 человек',
];

function InitIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'search':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="10" cy="10" r="6" />
          <path d="M14.5 14.5 L20 20" />
        </svg>
      );
    case 'pencil':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
          <path d="M14 7l3 3" />
        </svg>
      );
    case 'sliders':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16" />
          <circle cx="9" cy="7" r="2.5" />
          <path d="M4 17h16" />
          <circle cx="15" cy="17" r="2.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 20v-8" />
          <path d="M12 20V5" />
          <path d="M18 20v-5" />
          <path d="M3 20h18" />
        </svg>
      );
  }
}

type Review = {
  _id: string;
  name: string;
  result: string;
  text: string;
};

const DEFAULT_REVIEWS: Review[] = [
  {
    _id: 'default-1',
    name: 'Анастасия К.',
    result: '87 баллов ЦТ',
    text: 'Я была уверена, что математика — это не моё. После трёх месяцев в Дистрикте я сдала ЦТ на 87 баллов. Геометрию объяснили так, что я сама начала решать задачи, которые раньше казались невозможными.',
  },
  {
    _id: 'default-2',
    name: 'Дмитрий Л.',
    result: '91 балл ЦТ',
    text: 'Формат с куратором в Telegram — это огонь. Никогда не чувствовал, что остаюсь один на один с непонятным заданием. Всегда отвечали быстро и по делу.',
  },
  {
    _id: 'default-3',
    name: 'Полина М.',
    result: '84 балла ЦТ',
    text: 'Мама сначала сомневалась в онлайн-формате. Но когда увидела мой прогресс и мои домашки с живыми комментариями куратора — она сама посоветовала школу подруге.',
  },
  {
    _id: 'default-4',
    name: 'Артем С.',
    result: '94 балла ЦТ',
    text: 'Геймификация реально работает: карта прогресса и «боссы» вместо обычных контрольных. Сам не заметил, как начал решать часть B ради следующего уровня, а не ради оценок.',
  },
];

const ROAD_D =
  'M 20 370 H 150 C 240 370 240 300 330 300 C 420 300 430 370 520 370 C 610 370 620 300 710 300 C 800 300 810 370 900 370 C 990 370 1000 300 1090 300 C 1180 300 1190 370 1280 370 C 1330 370 1415 356 1480 352';

// площадки-остановки миссий beside the road (SVG-координаты)
const MISSION_PADS = [
  { x: 330, y: 215 },
  { x: 520, y: 485 },
  { x: 710, y: 215 },
  { x: 900, y: 485 },
  { x: 1090, y: 215 },
];

export default function MainPageClient({ reviews }: { reviews?: Review[] }) {
  const reviewList = reviews && reviews.length > 0 ? reviews : DEFAULT_REVIEWS;
  const { openForm } = useForm();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  // панели характеристик/журнала всегда одной высоты:
  // короткая дорастает до высокой (без привязки к карточке персонажа)
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;

    const panels = Array.from(layout.querySelectorAll<HTMLElement>(
      '.main-panel--specs, .main-panel--journal'
    ));
    if (panels.length !== 2) return;

    const sync = () => {
      panels.forEach((el) => {
        el.style.minHeight = '0px';
      });
      const target = Math.max(panels[0].offsetHeight, panels[1].offsetHeight);
      panels.forEach((el) => {
        el.style.minHeight = `${target}px`;
      });
    };

    sync();
    const ro = new ResizeObserver(sync);
    panels.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const els = Array.from(root.querySelectorAll('[data-reveal]'));
    if (els.length === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('revealed'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const deco = root?.querySelector<HTMLElement>('.page-deco');
    if (!deco) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        deco.style.transform = `translateY(${window.scrollY * -0.05}px)`;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="main-page" ref={rootRef}>
      <span className="side-rail side-rail--left" aria-hidden="true">
        GUILD // ONLINE MATH QUEST // ЦТ-2026
      </span>
      <span className="side-rail side-rail--right" aria-hidden="true">
        XP FARMING MODE // MATH.QUEST v2.6
      </span>

      <AtmosphereLayers />

      <div className="city-backdrop" aria-hidden="true" />
      <section className="hero" id="hero">
        <div className="hero-bg" aria-hidden="true" />
        <span className="hero-barcode" aria-hidden="true" />
        <p className="hero-coords" aria-hidden="true">
          53.9006° N, 27.5590° E // MINSK NODE // UPLINK STABLE
        </p>
        <div className="container hero-content">
          <p className="hero-eyebrow">Онлайн-школа по математике</p>
          <div className="hero-brand">District</div>
          <h1 className="hero-headline">
            Готовим
            <br />
            <span className="gold">победителей</span>
          </h1>

          <div className="main-hero-actions">
            <div className="main-hero-chips">
              <div className="main-hero-chip">
                <span className="chip-pill">Живые вебинары</span>
                <span className="chip-pill">Геймифицированная платформа</span>
                <span className="chip-pill">Личный куратор</span>
              </div>
              <div className="main-hero-chip">
                <span className="chip-pill">Здесь подготовка - это квест</span>
                <span className="chip-note">Ты не просто учишь формулы, ты:</span>
                <span className="chip-check">
                  <span className="box" aria-hidden="true" />
                  Открываешь секретные коды фракций
                </span>
                <span className="chip-check">
                  <span className="box" aria-hidden="true" />
                  Прокачиваешь личный прогресс на карте
                </span>
                <span className="chip-check">
                  <span className="box" aria-hidden="true" />
                  Общаешься с наставником в закрытом ТГ-канале
                </span>
              </div>
            </div>

            <a className="hero-signup" href="#signup">
              Записаться
            </a>
          </div>
        </div>
      </section>

      <section className="main-teacher" id="teacher" data-reveal>
        <span className="watermark" aria-hidden="true">MENTOR</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 01 // НАСТАВНИК ГИЛЬДИИ :: READY</span>
          <h2 className="main-teacher-title">
            <span className="line">Твой наставник по математике</span>
          </h2>

          <div className="main-teacher-layout" ref={layoutRef}>
            <aside className="main-panel main-panel--specs">
              <p className="main-panel-title">Характеристики</p>
              {SPECS.map((spec) => (
                <div className="spec-row" key={spec.label}>
                  <span className="spec-label">{spec.label}</span>
                  <span className="spec-value">{spec.value}%</span>
                  <span className="spec-bar">
                    <span
                      className={`spec-fill ${spec.value >= 50 ? 'spec-fill--epic' : 'spec-fill--common'}`}
                      style={{ width: `${spec.value}%` }}
                    />
                    <span className="spec-dot" style={{ left: `${spec.value}%` }} />
                  </span>
                </div>
              ))}
            </aside>

            <div className="mentor-card">
              <div className="mentor-frame">
                <img
                  src="/teachers/lidia.png"
                  alt="Лидия Владимировна — наставник по математике"
                />
              </div>
              <div className="mentor-plate">
                <span className="mentor-class">Наставник гильдии</span>
                <p className="mentor-name">Лидия Владимировна</p>
                <span className="mentor-level">LVL 99 · МАТЕМАТИКА</span>
              </div>
              <ul className="mentor-badges" aria-label="Достижения наставника">
                <li>❖ 98 баллов ЦТ</li>
                <li>❖ 4 года опыта</li>
                <li>❖ БГУ, мехмат</li>
              </ul>
            </div>

            <aside className="main-panel main-panel--journal">
              <p className="main-panel-title">Журнал заданий:</p>
              {DATA_ITEMS.map((item) => (
                <div className="data-item" key={item.title}>
                  <span className="data-hex" aria-hidden="true">
                    <svg viewBox="0 0 24 28" fill="none">
                      <polygon
                        points="12,1 23,7.5 23,20.5 12,27 1,20.5 1,7.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <polygon
                        points="12,9.5 16,12 16,16.5 12,19 8,16.5 8,12"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="data-title">{item.title}</p>
                    <p className="data-text">{item.text}</p>
                  </div>
                </div>
              ))}
            </aside>
          </div>

          <div className="main-teacher-notes">
            <div className="teacher-quote">
              <p className="status">[Наставник гильдии online. Сектор MM-01]</p>
              <p>
                «Математика — это четкая архитектура. Я научу твой мозг видеть
                скрытые ловушки составителей тестов за три секунды. Экзамен —
                это просто финальный босс, которого мы обязаны пройти на
                максимум.»
              </p>
              <div className="wave" aria-hidden="true">
                <div className="wave-bars">
                  {WAVE_BARS.map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
                <div className="wave-ticks" />
              </div>
              <svg className="quote-line" viewBox="0 0 130 112" fill="none" aria-hidden="true">
                <circle cx="6" cy="106" r="3" fill="#f5f8ff" />
                <path
                  d="M6 106 L64 100 L124 4"
                  stroke="rgba(245, 248, 255, 0.7)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            <div className="teacher-verify">
              <svg className="verify-line" viewBox="0 0 130 120" fill="none" aria-hidden="true">
                <circle cx="124" cy="106" r="3" fill="#f5f8ff" />
                <path
                  d="M124 106 L40 100 L-30 4"
                  stroke="rgba(245, 248, 255, 0.7)"
                  strokeWidth="1.5"
                />
              </svg>
              Код верификации подтвержден <span className="check">✓</span>
            </div>
          </div>
        </div>
      </section>

      <div className="data-strip" aria-hidden="true">
        <div className="data-strip-track">
          <span>
            GUILD.MATH // +500 XP ЗА УРОВЕНЬ // ★ LVL UP КАЖДУЮ НЕДЕЛЮ ★ // ДЕКОДИРУЙ ЗАДАНИЯ // РЕШАЙ ТОЛЬКО ТО, ЧТО БУДЕТ НА ЦТ // КОНТРОЛЬ КАЖДОГО ШАГА //&nbsp;
          </span>
          <span>
            GUILD.MATH // +500 XP ЗА УРОВЕНЬ // ★ LVL UP КАЖДУЮ НЕДЕЛЮ ★ // ДЕКОДИРУЙ ЗАДАНИЯ // РЕШАЙ ТОЛЬКО ТО, ЧТО БУДЕТ НА ЦТ // КОНТРОЛЬ КАЖДОГО ШАГА //&nbsp;
          </span>
        </div>
      </div>

      <section className="main-program" id="program" data-reveal>
        <span className="watermark watermark--left" aria-hidden="true">QUEST</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 02 // КАРТА МИССИЙ :: LVL 1–5</span>
          <h2 className="main-section-title">Программа обучения</h2>

          <div className="mission-map">
            <div className="mission-map-inner">
              <svg
                className="road-svg"
                viewBox="0 0 1500 720"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="roadSurface" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#0e1930" />
                    <stop offset="0.5" stopColor="#0b1322" />
                    <stop offset="1" stopColor="#080f1c" />
                  </linearGradient>
                </defs>

                {/* толщина дороги: смещённая подошва */}
                <path className="road-shadow" d={ROAD_D} />
                {/* неоновое свечение вокруг */}
                <path className="road-halo" d={ROAD_D} />
                {/* синие бордюры по краям */}
                <path className="road-curb" d={ROAD_D} />
                {/* полотно */}
                <path className="road-surface" d={ROAD_D} />
                {/* оранжевая осевая разметка со свечением */}
                <path className="road-mid-glow" d={ROAD_D} />
                <path className="road-mid" d={ROAD_D} />

                {/* фонари у поворотов */}
                <g className="lamp" transform="translate(425 0)">
                  <line x1="0" y1="252" x2="0" y2="281" />
                  <circle className="lamp-glow" cx="0" cy="248" r="11" />
                  <circle className="lamp-head" cx="0" cy="248" r="5" />
                </g>
                <g className="lamp" transform="translate(940 0)">
                  <line x1="0" y1="393" x2="0" y2="422" />
                  <circle className="lamp-glow" cx="0" cy="426" r="11" />
                  <circle className="lamp-head" cx="0" cy="426" r="5" />
                </g>

                {/* терминал START */}
                <g className="terminal terminal--start">
                  <rect className="terminal-pylon" x="86" y="302" width="9" height="22" rx="2" />
                  <rect className="terminal-pylon" x="155" y="302" width="9" height="22" rx="2" />
                  <rect className="terminal-body" x="75" y="320" width="100" height="100" rx="12" />
                  <rect className="terminal-inner" x="87" y="332" width="76" height="76" rx="8" />
                  <text x="125" y="377" textAnchor="middle" className="terminal-label">
                    START
                  </text>
                </g>

                {/* терминал FINISH + флаг */}
                <g className="terminal terminal--finish">
                  <rect className="terminal-pylon" x="1326" y="282" width="9" height="22" rx="2" />
                  <rect className="terminal-pylon" x="1395" y="282" width="9" height="22" rx="2" />
                  <rect className="terminal-body" x="1315" y="300" width="100" height="100" rx="12" />
                  <rect className="terminal-inner" x="1327" y="312" width="76" height="76" rx="8" />
                  <text x="1365" y="357" textAnchor="middle" className="terminal-label">
                    FINISH
                  </text>
                  <g className="flag">
                    <line x1="1400" y1="237" x2="1400" y2="282" />
                    <rect x="1401" y="237" width="20" height="13" rx="1" />
                  </g>
                </g>

                {/* площадки миссий + связки дорога↔площадка↔карточка */}
                {MISSION_PADS.map((pad, i) => {
                  const top = pad.y < 360;
                  return (
                    <g key={i} className="pad-group">
                      <line
                        className="pad-link"
                        x1={pad.x}
                        y1={top ? 237 : 426}
                        x2={pad.x}
                        y2={top ? 264 : 463}
                      />
                      <line
                        className="card-link"
                        x1={pad.x}
                        y1={top ? 176 : 507}
                        x2={pad.x}
                        y2={top ? 193 : 524}
                      />
                      <rect
                        className="pad"
                        x={pad.x - 32}
                        y={pad.y - 22}
                        width="64"
                        height="44"
                        rx="10"
                      />
                      <text
                        x={pad.x}
                        y={pad.y + 6}
                        textAnchor="middle"
                        className="pad-num"
                      >
                        {String(i + 1).padStart(2, '0')}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <span className="mobile-terminal mobile-terminal--start" aria-hidden="true">
                ▶ СТАРТ
              </span>

              <ol className="mission-list">
                {PROGRAM_STEPS.map((step, index) => (
                  <li
                    className={`mission mission--${index + 1}`}
                    key={step.title}
                    style={{
                      left: `${[22, 34.7, 47.3, 60, 72.7][index]}%`,
                      top: `${[12.6, 84.6, 12.6, 84.6, 12.6][index]}%`,
                    }}
                  >
                    <article className="mission-card">
                      <span className="mission-lvl">
                        Миссия {String(index + 1).padStart(2, '0')} · LVL {index + 1}
                      </span>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                      <span className="mission-xp" aria-hidden="true">
                        +{150 + index * 50} XP
                      </span>
                    </article>
                  </li>
                ))}
              </ol>

              <span className="mobile-terminal mobile-terminal--finish" aria-hidden="true">
                🏁 ФИНИШ
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="main-reviews" id="reviews" data-reveal>
        <span className="watermark" aria-hidden="true">SAGA</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 03 // ХРОНИКА ПОДВИГОВ :: LIVE</span>
          <h2 className="main-section-title">Отзывы</h2>

          <div
            className={`reviews-track${reviewList.length > 3 ? ' reviews-track--scroll' : ''}`}
          >
            {reviewList.map((review) => (
              <article className="review-card" key={review._id}>
                <span className="seal" aria-hidden="true">★</span>
                <p className="review-text">«{review.text}»</p>
                <p className="review-author">
                  — {review.name}, {review.result}
                </p>
              </article>
            ))}
          </div>

          <p className="reviews-stream" aria-hidden="true">
            Старт набора HEROIC_STORY_STREAM... 100%
            <span className="stream-line" />
            <span className="barcode" />
          </p>
        </div>
      </section>

      <div className="data-strip" aria-hidden="true">
        <div className="data-strip-track">
          <span>
            LOOT // 180 BYN // МЕСЯЦ ПОДГОТОВКИ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // ОРУЖЕЙНАЯ КОМНАТА // ★ LVL MAX ★ //&nbsp;
          </span>
          <span>
            LOOT // 180 BYN // МЕСЯЦ ПОДГОТОВКИ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // ОРУЖЕЙНАЯ КОМНАТА // ★ LVL MAX ★ //&nbsp;
          </span>
        </div>
      </div>

      <section className="main-init" id="signup" data-reveal>
        <span className="watermark watermark--left" aria-hidden="true">LOOT</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 04 // СНАРЯЖЕНИЕ :: 180_BYN</span>
          <h2 className="main-init-title">
            Время пройти <span className="gold">инициацию</span>
          </h2>
          <p className="main-init-sub">Полноценный абонемент на месяц</p>

          <div className="init-layout">
            <div className="init-steps">
              {INIT_STEPS.map((step, index) => (
                <div className="init-step" key={step.num}>
                  <div className="init-rail">
                    <span className="init-icon">
                      <InitIcon icon={step.icon} />
                    </span>
                    {index < INIT_STEPS.length - 1 && (
                      <span className="rail-line" aria-hidden="true" />
                    )}
                  </div>
                  <div className="init-body">
                    <span className="init-num">{step.num}</span>
                    <h3>{step.title}</h3>
                    {step.lines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="init-side">
              <div className="init-price">
                <p className="price-label">Стоимость</p>
                <p className="price-value">180 BYN</p>
                <p className="price-period">за один месяц подготовки</p>
                <p className="price-note">
                  100% возврат после первого занятия, если формат не подошёл
                </p>
              </div>
              <button
                type="button"
                className="init-cta"
                onClick={() => openForm({ variant: 'webinar', notice: COURSE_UNAVAILABLE_NOTICE })}
              >
                Записаться на курс
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="main-faq" id="faq" data-reveal>
        <span className="watermark" aria-hidden="true">FAQ</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 05 // СВИТКИ ВОПРОСОВ :: 24/7</span>
          <h2 className="main-section-title">Часто задаваемые вопросы</h2>
          <MainFaq />
        </div>
      </section>

      <section className="main-paths" id="paths" data-reveal>
        <span className="watermark" aria-hidden="true">PATHS</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">РАЗВИЛКА // ЕСЛИ КУРС НЕ ПОДХОДИТ</span>
          <h2 className="main-section-title">Не подошёл курс?</h2>

          <div className="paths-grid">
            <div className="path-col">
              <h3 className="path-title">Одиночный рейд</h3>
              <p className="path-sub">
                Индивидуальные занятия с наставником 5–11 класс
              </p>
              <div className="path-card">
                <p className="path-desc">
                  Личный маршрут по математике: программа, темп и фокус — только
                  под тебя. Наставник ведёт от диагностики до экзамена.
                </p>
                <ul className="path-perks">
                  {RAID_PERKS.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="path-col">
              <h3 className="path-title">Командный сектор</h3>
              <p className="path-sub">
                Занятия в мини-группах до 5-ти человек 5–10 класс
              </p>
              <div className="path-card">
                <p className="path-desc">
                  Мини-отряд до 5 человек: общий рейтинг, командные квесты и
                  дух соревнования — мотивация, которой не хватает в одиночку.
                </p>
                <ul className="path-perks">
                  {SQUAD_PERKS.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <a className="paths-cta" href="/individual">
            Узнать больше
          </a>
        </div>
      </section>
    </div>
  );
}
