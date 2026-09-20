'use client';

import { useEffect, useRef, useState } from 'react';
import MainFaq from '@/components/ui/MainFaq';
import AtmosphereLayers from '@/components/ui/AtmosphereLayers';
import { useForm } from '@/contexts/FormContext';
import type { MainPageContent } from '@/data/mainPageContent';
import {
  MAIN_PAGE_DEFAULTS,
  pickStr,
  pickArr,
  pickNum,
  formatSpecLabel,
} from '@/data/mainPageContent';

// Платный курс пока не подключён: кнопка записи показывает сообщение
// и предлагает бесплатный пробный вебинар (Telegram).
const COURSE_UNAVAILABLE_NOTICE =
  'Запись на платный курс пока недоступна. Запишись на бесплатный пробный вебинар, чтобы познакомиться с форматом.';

// Заголовок: «Готовим» белым, последнее слово — оранжевым неоном.
function HeroHeadline({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return <span className="hero-headline-accent">{text}</span>;
  const last = words[words.length - 1];
  const rest = words.slice(0, -1).join(' ');
  return (
    <>
      <span className="hero-headline-main">{rest}</span>
      <br />
      <span className="hero-headline-accent">{last}</span>
    </>
  );
}

function GoldLastWord({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return <span className="gold">{text}</span>;
  const last = words[words.length - 1];
  const rest = words.slice(0, -1).join(' ');
  return (
    <>
      {rest} <span className="gold">{last}</span>
    </>
  );
}

const HERO_NAV_ICONS = [
  // живые вебинары
  'M8 5h8l4 4v10H8V5z M12 9v6 M9.5 12h5',
  // платформа
  'M5 5h6v6H5V5z M13 5h6v6h-6V5z M5 13h6v6H5v-6z M13 13h6v6h-6v-6z',
  // наставник
  'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M6 20v-1a6 6 0 0 1 12 0v1',
] as const;

function HeroNavIcon({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={HERO_NAV_ICONS[index % HERO_NAV_ICONS.length]}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

// резкий зигзаг — только прямые сегменты, без bezier
const ROAD_D =
  'M 20 370 H 150 L 240 300 H 330 L 420 370 H 520 L 610 300 H 710 L 800 370 H 900 L 990 300 H 1090 L 1180 370 H 1280 L 1370 352 H 1480';

const ROAD_HALF = 36;
const PAD_H = 44;

type MissionPad = {
  x: number;
  roadY: number;
  cardAbove: boolean;
};

const MISSION_PADS: MissionPad[] = [
  { x: 300, roadY: 300, cardAbove: true },
  { x: 495, roadY: 370, cardAbove: false },
  { x: 710, roadY: 300, cardAbove: true },
  { x: 925, roadY: 370, cardAbove: false },
  { x: 1140, roadY: 300, cardAbove: true },
];

function padGeometry(pad: MissionPad) {
  if (pad.cardAbove) {
    const bottom = pad.roadY - ROAD_HALF + 2;
    const center = bottom - PAD_H / 2;
    return {
      center,
      padLink: [pad.roadY - ROAD_HALF, bottom] as const,
      cardLink: [center - PAD_H / 2 - 58, center - PAD_H / 2 - 30] as const,
    };
  }
  const top = pad.roadY + ROAD_HALF - 2;
  const center = top + PAD_H / 2;
  return {
    center,
    padLink: [pad.roadY + ROAD_HALF, top] as const,
    cardLink: [center + PAD_H / 2 + 18, center + PAD_H / 2 + 38] as const,
  };
}

// точки-светофоры на поворотах
const ROAD_DOTS = [
  { x: 240, y: 335 },
  { x: 420, y: 335 },
  { x: 610, y: 335 },
  { x: 800, y: 335 },
  { x: 990, y: 335 },
  { x: 1180, y: 335 },
];

export default function MainPageClient({
  reviews,
  content,
}: {
  reviews?: Review[];
  content?: MainPageContent;
}) {
  const reviewList = reviews && reviews.length > 0 ? reviews : DEFAULT_REVIEWS;
  const { openForm } = useForm();

  // Контент из Sanity с фолбэками на статические дефолты.
  const D = MAIN_PAGE_DEFAULTS;
  const hero = content?.hero;
  const heroEyebrow = pickStr(hero?.eyebrow, D.hero.eyebrow);
  const heroHeadline = pickStr(hero?.headline, D.hero.headline);
  const heroPills = pickArr(hero?.pills, D.hero.pills);
  const heroQuestTitle = pickStr(hero?.questTitle, D.hero.questTitle);
  const heroQuestNote = pickStr(hero?.questNote, D.hero.questNote);
  const heroQuestPoints = pickArr(hero?.questPoints, D.hero.questPoints);
  const heroButtonText = pickStr(hero?.buttonText, D.hero.buttonText);

  const mentor = content?.mentor;
  const mentorSectionTitle = pickStr(mentor?.sectionTitle, D.mentor.sectionTitle);
  const specs = pickArr(mentor?.specs, D.mentor.specs).map((s) => ({
    label: formatSpecLabel(pickStr(s?.label, '')),
    value: pickNum(s?.value, 0),
  }));
  const journal = pickArr(mentor?.journal, D.mentor.journal);
  const mentorName = pickStr(mentor?.mentorName, D.mentor.mentorName);
  const mentorClass = pickStr(mentor?.mentorClass, D.mentor.mentorClass);
  const mentorLevel = pickStr(mentor?.mentorLevel, D.mentor.mentorLevel);
  const mentorBadges = pickArr(mentor?.badges, D.mentor.badges);
  const quoteStatus = pickStr(mentor?.quoteStatus, D.mentor.quoteStatus);
  const quoteText = pickStr(mentor?.quoteText, D.mentor.quoteText);

  const program = content?.program;
  const programSectionTitle = pickStr(program?.sectionTitle, D.program.sectionTitle);
  const missions = pickArr(program?.missions, D.program.missions);

  const reviewsSectionTitle = pickStr(content?.reviews?.sectionTitle, D.reviews.sectionTitle);

  const init = content?.init;
  const initSectionTitle = pickStr(init?.sectionTitle, D.init.sectionTitle);
  const initSubtitle = pickStr(init?.subtitle, D.init.subtitle);
  const initSteps = pickArr(init?.steps, D.init.steps);
  const priceLabel = pickStr(init?.priceLabel, D.init.priceLabel);
  const priceValue = pickStr(init?.priceValue, D.init.priceValue);
  const pricePeriod = pickStr(init?.pricePeriod, D.init.pricePeriod);
  const priceNote = pickStr(init?.priceNote, D.init.priceNote);
  const initButtonText = pickStr(init?.buttonText, D.init.buttonText);
  const initKicker = `КВЕСТ 04 // СНАРЯЖЕНИЕ :: ${priceValue.replace(/\s+/g, '_')}`;

  const faqSectionTitle = pickStr(content?.faq?.sectionTitle, D.faq.sectionTitle);
  const faqItems = pickArr(content?.faqItems, D.faqItems).map((item) => ({
    q: pickStr(item?.question, ''),
    a: pickStr(item?.answer, ''),
  }));

  const paths = content?.paths;
  const pathsSectionTitle = pickStr(paths?.sectionTitle, D.paths.sectionTitle);
  const pathColumns = pickArr(paths?.columns, D.paths.columns);
  const pathsCtaText = pickStr(paths?.ctaText, D.paths.ctaText);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<HTMLDivElement | null>(null);
  const [mentorConnectors, setMentorConnectors] = useState<{
    leftPath: string;
    rightPath: string;
    plateLeft: { x: number; y: number };
    plateRight: { x: number; y: number };
    quoteRight: { x: number; y: number };
    verifyLeft: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    const notes = notesRef.current;
    if (!notes) return;

    const sync = () => {
      if (window.innerWidth <= 980) {
        setMentorConnectors(null);
        return;
      }

      const conn = notes.querySelector<SVGSVGElement>('.mentor-connectors');
      const plate = document.querySelector<HTMLElement>('.mentor-plate');
      const quote = notes.querySelector<HTMLElement>('.teacher-quote');
      const verify = notes.querySelector<HTMLElement>('.teacher-verify');
      if (!conn || !plate || !quote || !verify) return;

      const fmt = (n: number) => Number(n.toFixed(2));

      const pr = plate.getBoundingClientRect();
      const qr = quote.getBoundingClientRect();
      const vr = verify.getBoundingClientRect();
      const badges = document.querySelector('.mentor-badges');
      const badgesRect = badges?.getBoundingClientRect();
      const linkY = badgesRect
        ? badgesRect.top + badgesRect.height / 2
        : pr.bottom - 8;
      const startY = pr.top + pr.height * 0.5;

      const pagePoints = [
        { x: pr.left, y: startY },
        { x: pr.right, y: startY },
        { x: qr.right, y: linkY },
        { x: vr.left, y: linkY },
      ];
      const notesRect = notes.getBoundingClientRect();
      const minY = Math.min(...pagePoints.map((p) => p.y));
      const maxY = Math.max(...pagePoints.map((p) => p.y));
      conn.style.top = `${minY - notesRect.top - 6}px`;
      conn.style.height = `${maxY - minY + 12}px`;

      const connRect = conn.getBoundingClientRect();
      const vb = conn.viewBox.baseVal;
      if (connRect.width <= 0 || connRect.height <= 0) return;

      const toSvg = (x: number, y: number) => ({
        x: vb.x + ((x - connRect.left) / connRect.width) * vb.width,
        y: vb.y + ((y - connRect.top) / connRect.height) * vb.height,
      });

      const plateLeft = toSvg(pr.left, startY);
      const plateRight = toSvg(pr.right, startY);
      const quoteRight = toSvg(qr.right, linkY);
      const verifyLeft = toSvg(vr.left, linkY);

      const leftBend = {
        x: quoteRight.x + Math.max(14, (plateLeft.x - quoteRight.x) * 0.3),
        y: quoteRight.y,
      };
      const rightBend = {
        x: verifyLeft.x - Math.max(14, (verifyLeft.x - plateRight.x) * 0.3),
        y: verifyLeft.y,
      };

      setMentorConnectors({
        leftPath: `M ${fmt(plateLeft.x)} ${fmt(plateLeft.y)} L ${fmt(leftBend.x)} ${fmt(leftBend.y)} L ${fmt(quoteRight.x)} ${fmt(quoteRight.y)}`,
        rightPath: `M ${fmt(plateRight.x)} ${fmt(plateRight.y)} L ${fmt(rightBend.x)} ${fmt(rightBend.y)} L ${fmt(verifyLeft.x)} ${fmt(verifyLeft.y)}`,
        plateLeft,
        plateRight,
        quoteRight,
        verifyLeft,
      });
    };

    sync();
    const raf = requestAnimationFrame(sync);
    const ro = new ResizeObserver(sync);
    ro.observe(notes);
    const plate = document.querySelector('.mentor-plate');
    const quote = notes.querySelector('.teacher-quote');
    const verify = notes.querySelector('.teacher-verify');
    const badges = document.querySelector('.mentor-badges');
    if (plate) ro.observe(plate);
    if (quote) ro.observe(quote);
    if (verify) ro.observe(verify);
    if (badges) ro.observe(badges);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
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
      <AtmosphereLayers />

      <div className="city-backdrop" aria-hidden="true" />
      <section className="hero" id="hero">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-hud" aria-hidden="true">
          <span className="hero-hud-rail hero-hud-rail--left">STUDY / ONLINE / MATH / QUEST / 2026</span>
          <span className="hero-hud-rail hero-hud-rail--right">STUDY / ONLINE / MATH / QUEST / 2026</span>
          <p className="hero-coords">53.9010° N, 27.5490° E</p>
          <div className="hero-hud-foot">
            <span className="hero-hud-compass">N</span>
            <span className="hero-hud-foot-text">// MATHEMATICS — THIS IS NOT JUST A SUBJECT</span>
          </div>
        </div>
        <div className="container hero-content">
          <div className="hero-title-frame">
            <span className="hero-frame-mark hero-frame-mark--tl" aria-hidden="true" />
            <span className="hero-frame-mark hero-frame-mark--br" aria-hidden="true" />
            <p className="hero-eyebrow">
              <span className="hero-eyebrow-mark">//</span> {heroEyebrow}
            </p>
            <div className="hero-brand">District</div>
            <h1 className="hero-headline">
              <HeroHeadline text={heroHeadline} />
            </h1>
          </div>

          <div className="main-hero-actions">
            <div className="hero-panels-shell">
              <div className="hero-panels">
                <div className="hero-panel hero-panel--nav">
                  {heroPills.map((pill, index) => (
                    <div className="hero-nav-row" key={pill}>
                      <span className="hero-nav-ico">
                        <HeroNavIcon index={index} />
                      </span>
                      <span className="hero-nav-text">{pill}</span>
                      <span className="hero-nav-chev" aria-hidden="true">›</span>
                    </div>
                  ))}
                </div>

                <div className="hero-panel hero-panel--quest">
                  <div className="hero-quest-head">
                    <span className="hero-quest-target" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </span>
                    <span>{heroQuestTitle}</span>
                  </div>
                  <p className="hero-quest-note">{heroQuestNote}</p>
                  <ul className="hero-quest-list">
                    {heroQuestPoints.map((point) => (
                      <li key={point}>
                        <span className="hero-quest-check" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="hero-signup-wrap">
              <span className="hero-frame-mark hero-frame-mark--bl" aria-hidden="true" />
              <span className="hero-frame-mark hero-frame-mark--tr" aria-hidden="true" />
              <a className="hero-signup" href="#signup">
                {heroButtonText}
                <span className="hero-signup-arrow" aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="main-teacher" id="teacher" data-reveal>
        <span className="watermark" aria-hidden="true">MENTOR</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 01 // НАСТАВНИК ГИЛЬДИИ :: READY</span>
          <h2 className="main-teacher-title">
            <span className="line">{mentorSectionTitle}</span>
          </h2>

          <div className="main-teacher-layout" ref={layoutRef}>
            <aside className="main-panel main-panel--specs">
              <p className="main-panel-title">// 1. Характеристики</p>
              {specs.map((spec, index) => (
                <div className="spec-row" key={`${spec.label}-${index}`}>
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
                  src="/teachers/lidia2.png"
                  alt="Лидия Владимировна — наставник по математике"
                />
                <div className="mentor-plate">
                  <span className="mentor-class">{mentorClass}</span>
                  <p className="mentor-name">{mentorName}</p>
                  <span className="mentor-level">{mentorLevel}</span>
                </div>
              </div>
              <ul className="mentor-badges" aria-label="Достижения наставника">
                {mentorBadges.map((badge) => (
                  <li key={badge}>{badge}</li>
                ))}
              </ul>
            </div>

            <aside className="main-panel main-panel--journal">
              <p className="main-panel-title">// 2. Журнал заданий</p>
              {journal.map((item, index) => (
                <div className="data-item" key={`${item.title}-${index}`}>
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

          <div className="main-teacher-notes" ref={notesRef}>
            <svg className="mentor-connectors" viewBox="0 0 1000 120" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <defs>
                <filter id="mentor-line-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {mentorConnectors && (
                <g filter="url(#mentor-line-glow)">
                  <path
                    d={mentorConnectors.leftPath}
                    stroke="#ff9a2e"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={mentorConnectors.plateLeft.x} cy={mentorConnectors.plateLeft.y} r="3" fill="#ff9a2e" />
                  <circle cx={mentorConnectors.quoteRight.x} cy={mentorConnectors.quoteRight.y} r="3" fill="#ff9a2e" />
                  <path
                    d={mentorConnectors.rightPath}
                    stroke="#ff9a2e"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={mentorConnectors.plateRight.x} cy={mentorConnectors.plateRight.y} r="3" fill="#ff9a2e" />
                  <circle cx={mentorConnectors.verifyLeft.x} cy={mentorConnectors.verifyLeft.y} r="3" fill="#ff9a2e" />
                </g>
              )}
            </svg>

            <div className="teacher-quote">
              <p className="status">{quoteStatus}</p>
              <p className="teacher-quote-text">«{quoteText}»</p>
            </div>

            <div className="teacher-verify">
              <span className="teacher-verify-text">Код верификации подтвержден</span>
              <span className="check" aria-hidden="true">✓</span>
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
          <h2 className="main-section-title">{programSectionTitle}</h2>

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

                {/* отражение дороги на «полу» */}
                <path className="road-reflection" d={ROAD_D} />

                {/* маркеры на поворотах */}
                {ROAD_DOTS.map((dot, i) => (
                  <circle key={i} className="road-dot" cx={dot.x} cy={dot.y} r="3.5" />
                ))}

                {/* фонари у острых поворотов */}
                <g className="lamp" transform="translate(420 0)">
                  <line x1="0" y1="318" x2="0" y2="348" />
                  <circle className="lamp-glow" cx="0" cy="314" r="11" />
                  <circle className="lamp-head" cx="0" cy="314" r="5" />
                </g>
                <g className="lamp" transform="translate(800 0)">
                  <line x1="0" y1="348" x2="0" y2="378" />
                  <circle className="lamp-glow" cx="0" cy="382" r="11" />
                  <circle className="lamp-head" cx="0" cy="382" r="5" />
                </g>
                <g className="lamp" transform="translate(1180 0)">
                  <line x1="0" y1="318" x2="0" y2="348" />
                  <circle className="lamp-glow" cx="0" cy="314" r="11" />
                  <circle className="lamp-head" cx="0" cy="314" r="5" />
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
                  const geo = padGeometry(pad);
                  return (
                    <g key={i} className="pad-group">
                      <line
                        className="pad-link"
                        x1={pad.x}
                        y1={geo.padLink[0]}
                        x2={pad.x}
                        y2={geo.padLink[1]}
                      />
                      <line
                        className="card-link"
                        x1={pad.x}
                        y1={geo.cardLink[0]}
                        x2={pad.x}
                        y2={geo.cardLink[1]}
                      />
                      <rect
                        className="pad"
                        x={pad.x - 32}
                        y={geo.center - 22}
                        width="64"
                        height="44"
                        rx="10"
                      />
                      <text
                        x={pad.x}
                        y={geo.center + 6}
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
                {missions.map((step, index) => {
                  const pad = MISSION_PADS[index];
                  return (
                  <li
                    className={`mission mission--${index + 1}`}
                    key={`${step.title}-${index}`}
                    style={{
                      left: pad ? `${(pad.x / 1500) * 100}%` : undefined,
                      top: pad ? (pad.cardAbove ? '11%' : '79%') : undefined,
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
                  );
                })}
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
          <h2 className="main-section-title">{reviewsSectionTitle}</h2>

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
            {`LOOT // ${priceValue} // МЕСЯЦ ПОДГОТОВКИ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // ОРУЖЕЙНАЯ КОМНАТА // ★ LVL MAX ★ //\u00A0`}
          </span>
          <span>
            {`LOOT // ${priceValue} // МЕСЯЦ ПОДГОТОВКИ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // ОРУЖЕЙНАЯ КОМНАТА // ★ LVL MAX ★ //\u00A0`}
          </span>
        </div>
      </div>

      <section className="main-init" id="signup" data-reveal>
        <span className="watermark watermark--left" aria-hidden="true">LOOT</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">{initKicker}</span>
          <h2 className="main-init-title">
            <GoldLastWord text={initSectionTitle} />
          </h2>
          <p className="main-init-sub">{initSubtitle}</p>

          <div className="init-layout">
            <div className="init-steps">
              {initSteps.map((step, index) => (
                <div className="init-step" key={`${step.title}-${index}`}>
                  <div className="init-rail">
                    <span className="init-icon">
                      <InitIcon icon={step.icon ?? 'chart'} />
                    </span>
                    {index < initSteps.length - 1 && (
                      <span className="rail-line" aria-hidden="true" />
                    )}
                  </div>
                  <div className="init-body">
                    <span className="init-num">{String(index + 1).padStart(2, '0')}</span>
                    <h3>{step.title}</h3>
                    {(step.lines ?? []).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="init-side">
              <div className="init-price">
                <span className="init-price-mark init-price-mark--tl" aria-hidden="true" />
                <span className="init-price-mark init-price-mark--br" aria-hidden="true" />
                <p className="price-label">{priceLabel}</p>
                <p className="price-value">{priceValue}</p>
                <p className="price-period">{pricePeriod}</p>
                <p className="price-note">{priceNote}</p>
              </div>
              <button
                type="button"
                className="init-cta"
                onClick={() => openForm({ variant: 'webinar', notice: COURSE_UNAVAILABLE_NOTICE })}
              >
                {initButtonText}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="main-faq" id="faq" data-reveal>
        <span className="watermark" aria-hidden="true">FAQ</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">КВЕСТ 05 // СВИТКИ ВОПРОСОВ :: 24/7</span>
          <h2 className="main-section-title">{faqSectionTitle}</h2>
          <MainFaq items={faqItems} />
        </div>
      </section>

      <section className="main-paths" id="paths" data-reveal>
        <span className="watermark" aria-hidden="true">PATHS</span>
        <div className="container">
          <span className="section-kicker section-kicker--center">РАЗВИЛКА // ЕСЛИ КУРС НЕ ПОДХОДИТ</span>
          <h2 className="main-section-title">{pathsSectionTitle}</h2>

          <div className="paths-grid">
            {pathColumns.map((col, index) => (
              <div
                className={`path-col ${index === 0 ? 'path-col--solo' : 'path-col--team'}`}
                key={`${col.title}-${index}`}
              >
                <h3 className="path-title">{col.title}</h3>
                <p className="path-sub">{col.sub}</p>
                <div className="path-card">
                  <span className="path-card-mark path-card-mark--tl" aria-hidden="true" />
                  <span className="path-card-mark path-card-mark--br" aria-hidden="true" />
                  <p className="path-desc">{col.description}</p>
                  <div className="path-perks-wrap">
                    <ul className="path-perks">
                      {(col.perks ?? []).map((perk) => (
                        <li key={perk}>{perk}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <a className="paths-cta" href="/individual">
            {pathsCtaText}
          </a>
        </div>
      </section>
    </div>
  );
}
