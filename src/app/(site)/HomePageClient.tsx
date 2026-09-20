"use client";

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import DiagnosticSection from '@/components/ui/DiagnosticSection';
import IndProcessCardFrame from '@/components/ui/IndProcessCardFrame';
import AtmosphereLayers from '@/components/ui/AtmosphereLayers';
import { useForm } from '@/contexts/FormContext';
import { Principle, ProcessStep, Stat, Teacher } from '@/data/types';
import { SiteSettings } from '@/lib/studio/sanityData';
import type { IndividualPageContent, FormatColumn } from '@/data/individualPageContent';
import { INDIVIDUAL_PAGE_DEFAULTS } from '@/data/individualPageContent';
import { pickArr, pickStr } from '@/data/mainPageContent';
import { urlFor } from '@/lib/studio/sanityImage';

type Format = 'solo' | 'group';
type VsFocus = 'solo' | 'group' | null;

const SOLO_MATCH = /индивиду|соло|solo|1-на-1/i;
const GROUP_MATCH = /групп|команд|squad/i;

function splitSectionTitle(title: string, gold: string): { title: string; gold: string } {
  const goldTrimmed = gold.trim();
  const titleTrimmed = title.trim();
  if (!goldTrimmed) return { title: titleTrimmed, gold: '' };

  const titleLower = titleTrimmed.toLowerCase();
  const goldLower = goldTrimmed.toLowerCase();
  const goldIdx = titleLower.lastIndexOf(goldLower);

  if (goldIdx > 0) {
    const white = titleTrimmed.slice(0, goldIdx).trimEnd().replace(/,\s*$/, ',');
    return { title: white, gold: goldTrimmed };
  }

  return { title: titleTrimmed, gold: goldTrimmed };
}

function formatPrinciplesTitleWhite(title: string, gold: string): string {
  let trimmed = title.trim();
  if (/которых мы стоим/i.test(gold) && !/,\s*на\s*$/iu.test(trimmed)) {
    trimmed = `${trimmed.replace(/,\s*$/, '')},\u00A0на`;
  } else {
    trimmed = trimmed.replace(/,\s*на\s*$/iu, ',\u00A0на');
  }
  return trimmed.replace(/^три\s+принципа/iu, 'Три\u00A0принципа');
}

function formatPrinciplesTitleGold(gold: string): string {
  return gold.trim().replace(/\s+/g, '\u00A0');
}

function splitPrinciplesSubtitle(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const explicitLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (explicitLines.length > 1) return explicitLines;

  const sentenceBreak = trimmed.match(/^(.+?[.!?…])\s+(Это\b.+)$/u);
  if (sentenceBreak) {
    return [sentenceBreak[1].trim(), sentenceBreak[2].trim()];
  }

  return [trimmed];
}

// Иконки преимуществ в блоке записи (по порядку карточек).
const BENEFIT_ICONS = [
  <svg key="benefit-pro" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6"/><path d="M8.6 12l2.1 2.1 4.8-5" stroke="currentColor" strokeWidth="1.6"/></svg>,
  <svg key="benefit-personal" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9L7 7m10 10l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="currentColor" strokeWidth="1.3"/></svg>,
  <svg key="benefit-schedule" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7.5 3v5m9-5v5M3.5 10h17M8 14h2m4 0h2M8 17h2m4 0h2" stroke="currentColor" strokeWidth="1.35"/></svg>,
];

// Пиктограмма чипа наставника подбирается по смыслу текста из Sanity.
const BADGE_ICON_PATHS = {
  cap: 'M3 9.2L12 5l9 4.2-9 4.2-9-4.2z M7 11.4v4.1c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-4.1',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v4.4l3 1.8',
  pin: 'M12 3.5c3 0 5.5 2.4 5.5 5.4 0 4-5.5 11.6-5.5 11.6S6.5 12.9 6.5 8.9C6.5 5.9 9 3.5 12 3.5z M12 10.6a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z',
  spark: 'M12 3l1.7 5.6L19 10l-5.3 1.4L12 17l-1.7-5.6L5 10l5.3-1.4L12 3z',
} as const;

function StatOctagonFrame() {
  return (
    <svg className="ind-stat-icon-oct" viewBox="0 0 48 48" aria-hidden="true">
      <polygon
        points="24,2 44,10 46,24 44,38 24,46 4,38 2,24 4,10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StatIcon({ index }: { index: number }) {
  const icons = [
    <svg key="stat-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14v12H5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4h8v3H8zM8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,
    <svg key="stat-1" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,
    <svg key="stat-2" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 9.5 12 5l9 4.5L12 14 3 9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 11.5V16c0 1.5 2.7 2.7 6 2.7s6-1.2 6-2.7v-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,
    <svg key="stat-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 11l-3.5 2v4.5c1.2.8 2.8 1.2 4.5 1.2M17 11l3.5 2v4.5c-1.2.8-2.8 1.2-4.5 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 11c0-2.2 2.2-4 5-4s5 1.8 5 4M12 7V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,
  ];

  return icons[index % icons.length];
}

function IndSlotIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.6 12l2.1 2.1 4.8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TeacherBadgeIcon({ badge }: { badge: string }) {
  const text = badge.toLowerCase();
  const kind = /балл|цт|цэ|экзам|егэ|олимпиад/.test(text)
    ? 'cap'
    : /год|лет|опыт|стаж/.test(text)
      ? 'clock'
      : /бгу|бгпу|мехмат|универ|факульт|кафедр|лиц|школ/.test(text)
        ? 'pin'
        : 'spark';

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={BADGE_ICON_PATHS[kind]}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomePageClient({
  content,
  teachers,
  stats,
  principles,
  processSteps,
  siteSettings,
}: {
  content: IndividualPageContent | null;
  teachers: Teacher[];
  stats: Stat[];
  principles: Principle[];
  processSteps: ProcessStep[];
  siteSettings?: SiteSettings | null;
}) {
  const { openForm } = useForm();
  const [format, setFormat] = useState<Format>('solo');

  const handleFormat = (next: Format) => {
    if (next !== format) setFormat(next);
  };
  const [vsFocus, setVsFocus] = useState<VsFocus>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-reveal], [data-scroll-reveal], .principle-item, .process-step-alt',
      ),
    );
    if (targets.length === 0) return;

    const revealTarget = (target: HTMLElement, animate: boolean) => {
      const isStagedReveal = target.hasAttribute('data-scroll-reveal');
      const wasAnimated = target.dataset.scrollRevealPlayed === 'true';

      target.classList.add('revealed');
      target.classList.add('visible');
      if (isStagedReveal) target.classList.add('scroll-revealed');

      if (!animate || !isStagedReveal || wasAnimated || typeof target.animate !== 'function') {
        return;
      }

      target.dataset.scrollRevealPlayed = 'true';
      const direction = target.dataset.revealDirection;
      const origin =
        direction === 'left'
          ? 'translate3d(-22px, 0, 0)'
          : direction === 'right'
            ? 'translate3d(22px, 0, 0)'
            : 'translate3d(0, 22px, 0)';
      const order = Number.parseInt(target.dataset.revealDelay || '0', 10);
      const delay = Number.isFinite(order) ? Math.max(0, order) * 80 : 0;

      target.animate(
        [
          { opacity: 0, transform: origin },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 620,
          delay,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
    };

    if (reduceMotion) {
      targets.forEach((target) => revealTarget(target, false));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            revealTarget(entry.target as HTMLElement, true);
            currentObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [format]);

  // Контент из Sanity с дефолтами: пустой блок/поле = статический текст.
  const D = INDIVIDUAL_PAGE_DEFAULTS;
  const hero = content?.hero;
  const heroKicker = pickStr(hero?.kicker, D.hero.kicker);
  const heroTitle = pickStr(hero?.title, D.hero.title);
  const heroDescription = pickStr(hero?.description, D.hero.description);
  const heroPanelTitle = pickStr(hero?.panelTitle, D.hero.panelTitle);
  const heroSlots = pickArr(hero?.slots, D.hero.slots).map((slot) => ({
    icon: pickStr(slot?.icon, '◆'),
    title: pickStr(slot?.title, ''),
    sub: pickStr(slot?.sub, ''),
    href: pickStr(slot?.href, '#'),
  }));

  const teachersBlock = content?.teachers;
  const teachersKicker = pickStr(teachersBlock?.kicker, D.teachers.kicker);
  const teachersTitle = pickStr(teachersBlock?.sectionTitle, D.teachers.sectionTitle);

  const principlesBlock = content?.principles;
  const principlesKicker = pickStr(principlesBlock?.kicker, D.principles.kicker);
  const principlesTitleRaw = pickStr(principlesBlock?.sectionTitle, D.principles.sectionTitle);
  const principlesTitleGoldRaw = pickStr(
    principlesBlock?.sectionTitleGold,
    D.principles.sectionTitleGold ?? '',
  );
  const { title: principlesTitleRawSplit, gold: principlesTitleGold } = splitSectionTitle(
    principlesTitleRaw,
    principlesTitleGoldRaw,
  );
  const principlesTitle = formatPrinciplesTitleWhite(principlesTitleRawSplit, principlesTitleGold);
  const principlesTitleGoldDisplay = formatPrinciplesTitleGold(principlesTitleGold);
  const principlesSubtitleLines = splitPrinciplesSubtitle(
    pickStr(principlesBlock?.sectionSubtitle, D.principles.sectionSubtitle ?? ''),
  );

  const formatsBlock = content?.formats;
  const formatsKicker = pickStr(formatsBlock?.kicker, D.formats.kicker);
  const formatsTitle = pickStr(formatsBlock?.sectionTitle, D.formats.sectionTitle);
  const formatColumns = pickArr(formatsBlock?.columns, D.formats.columns);
  const normalizeColumn = (col: FormatColumn | undefined, fallback: FormatColumn) => ({
    icon: pickStr(col?.icon, fallback.icon ?? ''),
    title: pickStr(col?.title, fallback.title),
    sub: pickStr(col?.sub, fallback.sub ?? ''),
    description: pickStr(col?.description, fallback.description ?? ''),
    perks: pickArr(col?.perks, fallback.perks),
    ctaText: pickStr(col?.ctaText, fallback.ctaText ?? ''),
  });
  const soloColumn = normalizeColumn(formatColumns[0], D.formats.columns[0]);
  const groupColumn = normalizeColumn(formatColumns[1], D.formats.columns[1]);

  const processBlock = content?.process;
  const processKicker = pickStr(processBlock?.kicker, D.process.kicker);
  const processTitle = pickStr(processBlock?.sectionTitle, D.process.sectionTitle);

  const choosePath = content?.choosePath;
  const signupKicker = pickStr(choosePath?.kicker, D.choosePath.kicker);
  const signupTitle = pickStr(choosePath?.sectionTitle, D.choosePath.sectionTitle);
  const signupTitleGold = pickStr(choosePath?.sectionTitleGold, D.choosePath.sectionTitleGold);
  const soloTabText = pickStr(choosePath?.soloTabText, D.choosePath.soloTabText);
  const groupTabText = pickStr(choosePath?.groupTabText, D.choosePath.groupTabText);
  const trialGuideTitle = pickStr(choosePath?.trialGuideTitle, D.choosePath.trialGuideTitle);
  const trialGuideLines = pickStr(choosePath?.trialGuideText, D.choosePath.trialGuideText).split('\n');
  const benefits = pickArr(choosePath?.benefits, D.choosePath.benefits).map((benefit) => ({
    title: pickStr(benefit?.title, ''),
    text: pickStr(benefit?.text, ''),
  }));

  const diagnostic = content?.diagnostic;
  const diagnosticSteps = pickArr(diagnostic?.steps, D.diagnostic.steps).map((step) => ({
    title: pickStr(step?.title, ''),
    text: pickStr(step?.text, ''),
  }));

  const heroTitleWords = heroTitle.trim().split(/\s+/);
  const heroTitleLast = heroTitleWords[heroTitleWords.length - 1];
  const heroTitleRest = heroTitleWords.slice(0, -1).join(' ');

  const getServicesForFormat = (teacher: Teacher, matcher: RegExp) => {
    const services = Array.isArray(teacher.services) ? teacher.services : [];
    const matched = services.filter((service) => matcher.test(String(service.name || '')));
    return matched.length > 0 ? matched : services;
  };
  const teacherServices = teachers.map((teacher) => ({
    teacher,
    soloServices: getServicesForFormat(teacher, SOLO_MATCH),
    groupServices: getServicesForFormat(teacher, GROUP_MATCH),
  }));
  return (
    <div className="main-page sub-page">
      <AtmosphereLayers />
      <div className="city-backdrop" aria-hidden="true" />

      <section className="hero ind-hero" id="hero">
        <div className="hero-hud" aria-hidden="true">
          <span className="hero-hud-rail hero-hud-rail--right ind-hero-rail">
            DISTRICT // ONLINE // UNIIE / 2023
          </span>
        </div>

        <span className="watermark watermark--left" aria-hidden="true">MENTOR</span>

        <svg className="ind-hero-constellation" viewBox="0 0 520 320" fill="none" aria-hidden="true">
          <defs>
            <filter id="ind-star-glow-orange" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="ind-star-glow-blue" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g stroke="rgba(120, 185, 255, 0.34)" strokeWidth="1.1">
            <path d="M214 176 L268 198 L322 142 L378 168 L432 118 L478 146" />
            <path d="M322 142 L352 92 L378 168" />
            <path d="M432 118 L468 78 L478 146" />
          </g>
          <g filter="url(#ind-star-glow-orange)">
            <circle cx="268" cy="198" r="3.5" fill="#ff9a2e" />
            <circle cx="378" cy="168" r="3.5" fill="#ff9a2e" />
            <circle cx="478" cy="146" r="4" fill="#ff9a2e" />
            <circle cx="468" cy="78" r="2.5" fill="#ff9a2e" />
          </g>
          <g filter="url(#ind-star-glow-blue)">
            <circle cx="214" cy="176" r="5" fill="#8fd4f0" />
            <circle cx="322" cy="142" r="4.5" fill="#8fd4f0" />
            <circle cx="432" cy="118" r="5" fill="#8fd4f0" />
            <circle cx="352" cy="92" r="2.5" fill="#8fd4f0" />
          </g>
        </svg>

        <div className="container hero-content">
          <div className="ind-hero-grid">
            <div className="ind-hero-left">
              <Link className="ind-crumb" href="/">
                ← District · главная
              </Link>

              <span className="section-kicker ind-hero-kicker">{heroKicker}</span>

              <h1 className="ind-hero-title">
                <span className="ind-hero-title-line">{heroTitleRest}</span>
                <span className="ind-hero-title-line gold">{heroTitleLast}</span>
              </h1>

              <p className="ind-hero-desc">{heroDescription}</p>
            </div>

            <div className="ind-hero-panel-col">
            <aside className="ind-hero-panel-shell" aria-label="Выбор формата занятий">
              <span className="ind-hero-panel-mark ind-hero-panel-mark--tl" aria-hidden="true" />
              <span className="ind-hero-panel-mark ind-hero-panel-mark--tr" aria-hidden="true" />
              <span className="ind-hero-panel-mark ind-hero-panel-mark--bl" aria-hidden="true" />
              <span className="ind-hero-panel-mark ind-hero-panel-mark--br" aria-hidden="true" />
              <div className="ind-hero-panel">
                <p className="ind-panel-title">+ {heroPanelTitle.toUpperCase()}</p>
                <div className="ind-slot-list">
                {heroSlots.map((slot, index) => (
                  <a
                    className={`ind-slot${index === 0 ? ' ind-slot--solo' : ' ind-slot--team'}`}
                    href={slot.href}
                    key={slot.title}
                  >
                    <span className="ind-slot-icon" aria-hidden="true">
                      <IndSlotIcon index={index} />
                    </span>
                    <span className="ind-slot-text">
                      <b>{slot.title}</b>
                      <small>{slot.sub}</small>
                    </span>
                    <span className="ind-slot-arrow" aria-hidden="true">→</span>
                  </a>
                ))}
                </div>
              </div>
            </aside>
            </div>
          </div>
        </div>
      </section>

      <main className="site-main">
        {/* ---------- Наставник: карточка персонажа ---------- */}
        <section className="main-teacher ind-teacher" id="teachers" data-reveal>
          <span className="watermark" aria-hidden="true">MENTOR</span>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              {teachersKicker}
            </span>
            <h2 className="main-teacher-title">{teachersTitle}</h2>

            <div className="teacher-hud-grid">
              {teachers.map((teacher, index) => {
                const num = String(index + 1).padStart(2, '0');
                const metaItems = String(teacher.subject || '')
                  .split(/[•·|,]/)
                  .map((part) => part.trim())
                  .filter(Boolean);
                const blockBadges = Array.isArray(teachersBlock?.badges) ? teachersBlock.badges : [];
                const chips = (
                  Array.isArray(teacher.badges) && teacher.badges.length > 0
                    ? teacher.badges
                    : blockBadges
                )
                  .map((badge) => String(badge).trim())
                  .filter(Boolean);

                return (
                  <article
                    className="teacher-hud"
                    key={teacher._id}
                    data-scroll-reveal
                    data-reveal-direction={index % 2 === 0 ? 'left' : 'right'}
                    data-reveal-delay={String(index)}
                  >
                    <div className="teacher-hud__fill" aria-hidden="true" />
                    <span className="teacher-hud-corner teacher-hud-corner--tl" aria-hidden="true" />
                    <span className="teacher-hud-corner teacher-hud-corner--br" aria-hidden="true" />
                    <div className="teacher-hud-body">
                      <h3 className="teacher-hud-name">{teacher.name}</h3>
                      {metaItems.length > 0 && (
                        <p className="teacher-hud-meta">
                          {metaItems.map((item, itemIndex) => (
                            <span key={item} className={itemIndex === 0 ? 'is-accent' : undefined}>
                              {item}
                            </span>
                          ))}
                        </p>
                      )}
                      <p className="teacher-hud-desc">{teacher.description}</p>
                      {chips.length > 0 && (
                        <ul className="teacher-hud-chips" aria-label="Достижения наставника">
                          {chips.map((badge) => (
                            <li key={badge}>
                              <TeacherBadgeIcon badge={badge} />
                              {badge}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="teacher-hud-photo">
                      {teacher.photo ? (
                        <img
                          src={urlFor(teacher.photo).width(560).height(740).url()}
                          alt={`${teacher.name} — наставник по математике`}
                        />
                      ) : null}
                    </div>
                    <span className="teacher-hud-ghost" aria-hidden="true">
                      {num}
                    </span>
                    <span className="teacher-hud-hatch" aria-hidden="true" />
                  </article>
                );
              })}
            </div>

          </div>
        </section>

        {/* ---------- Принципы ---------- */}
        <section className="section section-principles ind-principles" id="principles" data-reveal>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              {principlesKicker}
            </span>

            {stats.length > 0 && (
              <div className="stats-ribbon ind-stats-ribbon">
                {stats.map((stat, index) => (
                  <div key={stat._id} className="stat-card ind-stat-card">
                    <div className="ind-stat-card__fill" aria-hidden="true" />
                    <span className="ind-stat-corner ind-stat-corner--tl" aria-hidden="true" />
                    <span className="ind-stat-corner ind-stat-corner--br" aria-hidden="true" />
                    <div className="ind-stat-inner">
                      <div className="ind-stat-top">
                        <span className="ind-stat-icon" aria-hidden="true">
                          <StatOctagonFrame />
                          <StatIcon index={index} />
                        </span>
                        <span className="stat-value">{stat.value}</span>
                      </div>
                      <span className="stat-label">{stat.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="principles-layout ind-principles-layout">
              <div className="principles-header ind-principles-header">
                <h2>
                  <span className="ind-principles-title-line">{principlesTitle}</span>
                  {principlesTitleGold ? (
                    <span className="ind-principles-title-line ind-principles-title-line--gold">
                      {principlesTitleGoldDisplay}
                    </span>
                  ) : null}
                </h2>
                {principlesSubtitleLines.length > 0 ? (
                  <div className="ind-principles-intro">
                    <span className="ind-principles-intro-mark" aria-hidden="true">///</span>
                    <p className="ind-principles-intro-text">
                      {principlesSubtitleLines.map((line, lineIndex) => (
                        <Fragment key={line}>
                          {lineIndex > 0 ? <br /> : null}
                          {line}
                        </Fragment>
                      ))}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="principles-list ind-principles-list">
                {principles.map((principle, index) => (
                  <div key={principle._id} className="principle-item ind-principle-item">
                    <span className="ind-principle-index" aria-hidden="true">
                      <span className="ind-principle-index-mark ind-principle-index-mark--tl" />
                      <span className="ind-principle-index-mark ind-principle-index-mark--br" />
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="principle-content">
                      <h3>{principle.title}</h3>
                      <p>{principle.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- VS-сплит: соло против команды ---------- */}
        <section className="main-paths ind-formats-vs" id="formats" data-reveal>
          <span className="watermark" aria-hidden="true">VS</span>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              {formatsKicker}
            </span>
            <h2 className="main-section-title">{formatsTitle}</h2>

            <div
              className={'vs-split' + (vsFocus ? ' vs-split--' + vsFocus + '-focus' : '')}
            >
              <div
                className="vs-side vs-side--solo"
                data-scroll-reveal
                data-reveal-direction="left"
                id="formats-solo"
                onMouseEnter={() => setVsFocus('solo')}
                onMouseLeave={() => setVsFocus(null)}
                onPointerEnter={() => setVsFocus('solo')}
                onPointerLeave={() => setVsFocus(null)}
                onFocus={() => setVsFocus('solo')}
                onBlur={() => setVsFocus(null)}
              >
                <h3 className="vs-title">{soloColumn.icon} {soloColumn.title}</h3>
                <p className="vs-sub">{soloColumn.sub}</p>
                <p className="vs-desc">
                  {soloColumn.description}
                </p>
                <ul className="vs-perks">
                  {soloColumn.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <a className="mini-cta" href="#signup" onClick={() => setFormat('solo')}>
                  {soloColumn.ctaText}
                </a>
              </div>

              <div className="vs-axis" aria-hidden="true">
                <span className={'vs-badge' + (vsFocus ? ' vs-badge--rotated' : '')}>VS</span>
              </div>

              <div
                className="vs-side vs-side--group"
                data-scroll-reveal
                data-reveal-direction="right"
                data-reveal-delay="1"
                id="formats-group"
                onMouseEnter={() => setVsFocus('group')}
                onMouseLeave={() => setVsFocus(null)}
                onPointerEnter={() => setVsFocus('group')}
                onPointerLeave={() => setVsFocus(null)}
                onFocus={() => setVsFocus('group')}
                onBlur={() => setVsFocus(null)}
              >
                <h3 className="vs-title">{groupColumn.icon} {groupColumn.title}</h3>
                <p className="vs-sub">{groupColumn.sub}</p>
                <p className="vs-desc">
                  {groupColumn.description}
                </p>
                <ul className="vs-perks">
                  {groupColumn.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <a className="mini-cta mini-cta--blue" href="#signup" onClick={() => setFormat('group')}>
                  {groupColumn.ctaText}
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="data-strip" aria-hidden="true">
          <div className="data-strip-track">
            <span>
              GUILD.MATH // +500 XP ЗА УРОВЕНЬ // ★ LVL UP КАЖДУЮ НЕДЕЛЮ ★ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // КОНТРОЛЬ КАЖДОГО ШАГА //&nbsp;
            </span>
            <span>
              GUILD.MATH // +500 XP ЗА УРОВЕНЬ // ★ LVL UP КАЖДУЮ НЕДЕЛЮ ★ // КУРАТОР 24/7 // ПЛАТФОРМА +XP // КОНТРОЛЬ КАЖДОГО ШАГА //&nbsp;
            </span>
          </div>
        </div>

        {/* ---------- Как проходит обучение ---------- */}
        <section className="section section-process ind-section ind-process" id="process" data-reveal>
          <div className="process-section-wrapper">
            <div className="container">
              <span className="section-kicker section-kicker--center">
                {processKicker}
              </span>
              <div className="process-header-new">
                <h2>{processTitle}</h2>
              </div>

              <div className="process-timeline-alt">
                <div className="timeline-center-line">
                  <div className="line-cap-top"></div>
                  <div className="line-cap-bottom"></div>
                </div>

                {processSteps.map((step, index) => (
                  <div
                    key={step._id}
                    className={`process-step-alt ${index % 2 === 0 ? 'step-left' : 'step-right'}`}
                  >
                    <div
                      className={`step-alt-card ind-process-card ${
                        index % 2 === 0 ? 'ind-process-card--left' : 'ind-process-card--right'
                      }`}
                    >
                      <IndProcessCardFrame />
                      <div className="ind-process-card__fill" aria-hidden="true" />
                      <span className="ind-process-slashes" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                      <div className="ind-process-num">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <span className="ind-process-divider" aria-hidden="true" />
                      <div className="ind-process-body">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </div>
                    <div className="step-alt-dot"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Запись: таб формата + цены ---------- */}
        <section className="main-init ind-signup" id="signup" data-reveal data-format={format}>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              {signupKicker}
            </span>
            <h2 className="main-init-title">
              {signupTitle} <span className="gold">{signupTitleGold}</span>
            </h2>
            <div className="format-tabs" role="tablist" aria-label="Форматы занятий">
              <button
                type="button"
                role="tab"
                aria-selected={format === 'solo'}
                className={'format-tab' + (format === 'solo' ? ' format-tab--active' : '')}
                onClick={() => handleFormat('solo')}
              >
                {soloTabText}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={format === 'group'}
                className={'format-tab' + (format === 'group' ? ' format-tab--active' : '')}
                onClick={() => handleFormat('group')}
              >
                {groupTabText}
              </button>
            </div>
            <div className={'signup-body booking-stage booking-stage--' + format}>
              {teacherServices.map(({ teacher, soloServices, groupServices }) => (
                <article
                  className={'booking-format-card booking-format-card--' + format}
                  data-scroll-reveal
                  key={teacher._id}
                >
                  {format === 'solo' ? (
                    <div className="booking-solo-layout">
                      <div className="booking-main-column">
                        <header className="booking-card-header">
                          <div className="booking-teacher-line">
                            <h3 className="booking-teacher-title">{teacher.name}</h3>
                            <span className="booking-teacher-label">• наставник</span>
                          </div>
                          <span className="booking-subject-badge">
                            <span className="badge-sigma" aria-hidden="true">Σ</span>
                            {teacher.subject}
                          </span>
                        </header>
                        <div className="booking-offer-column">
                        {soloServices.map((service) => (
                          <div className="booking-offer" key={service.name}>
                            <div className="booking-offer-icon" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" />
                              </svg>
                            </div>
                            <div className="booking-offer-copy">
                              <p className="booking-offer-type">{service.name}</p>
                              <p className="booking-offer-description">
                                Персональная программа и занятие 1 на 1
                              </p>
                              <span className="booking-offer-meta">
                                ◷ {service.duration || 'Время согласуем с наставником'}
                              </span>
                            </div>
                            <div className="booking-price-block">
                              <strong>
                                {typeof service.price === 'string' && service.price.trim()
                                  ? service.price
                                  : '45 BYN'}
                              </strong>
                              <span>за занятие</span>
                            </div>
                          </div>
                        ))}
                        </div>
                      </div>

                      <aside className="booking-trial-panel booking-trial-panel--solo">
                        <span className="booking-trial-mark" aria-hidden="true">☆</span>
                        <div>
                          <p className="booking-trial-kicker">Пробное занятие</p>
                          <strong className="booking-trial-price">
                            {typeof teacher.trialLesson.price === 'string' && teacher.trialLesson.price.trim()
                              ? teacher.trialLesson.price
                              : '15 BYN'}
                          </strong>
                          <p className="booking-trial-copy">
                            Обязательно перед началом индивидуальных занятий
                          </p>
                        </div>
                        <button
                          type="button"
                          className="booking-action booking-action--solo"
                          onClick={() =>
                            openForm({
                              teacher: teacher.name,
                              service: 'Пробное занятие',
                              price: teacher.trialLesson.price,
                            })
                          }
                        >
                          Записаться на пробное <span aria-hidden="true">→</span>
                        </button>
                      </aside>
                    </div>
                  ) : (
                    <div className="booking-solo-layout booking-group-layout">
                      <div className="booking-main-column booking-main-column--group">
                        <header className="booking-card-header booking-card-header--group">
                          <div className="booking-teacher-line">
                            <h3 className="booking-teacher-title">{teacher.name}</h3>
                            <span className="booking-teacher-label booking-teacher-label--group">• наставник</span>
                          </div>
                          <span className="booking-subject-badge booking-subject-badge--group">
                            <span className="badge-sigma booking-group-sigma" aria-hidden="true">Σ</span>
                            8–11 класс
                          </span>
                        </header>
                        <div className="booking-offer-column booking-offer-column--group">
                          {groupServices.map((service, index) => {
                            const serviceName =
                              typeof service.name === 'string' && service.name.trim()
                                ? service.name
                                : 'Групповое занятие';
                            const serviceTitle = serviceName.toLowerCase().includes('группов')
                              ? 'Групповое занятие'
                              : serviceName;
                            const serviceDescription = 'Занятие в небольшой группе';
                            const servicePrice =
                              typeof service.price === 'string' && service.price.trim()
                                ? service.price
                                : '25 BYN';
                            const raw =
                              typeof service.spotsStatus === 'string'
                                ? service.spotsStatus
                                : service.spotsStatus?.type;
                            const statusText =
                              raw === 'few'
                                ? 'Осталось мало мест'
                                : raw === 'none'
                                  ? 'Сейчас мест нет'
                                  : raw === 'many'
                                    ? 'Есть места'
                                    : 'Набор уточняется';
                            return (
                              <div className="booking-offer booking-offer--group" key={teacher._id + '-group-' + index}>
                                <div className="booking-offer-icon booking-offer-icon--group" aria-hidden="true">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                                    <circle cx="8" cy="9" r="3" />
                                    <circle cx="16" cy="9" r="3" />
                                    <path d="M2.7 19c.8-3 3.1-4.8 5.3-4.8s4.5 1.8 5.3 4.8" />
                                    <path d="M10.7 19c.75-2.85 2.95-4.8 5.3-4.8 2.2 0 4.45 1.8 5.3 4.8" />
                                  </svg>
                                </div>
                                <div className="booking-offer-copy">
                                  <p className="booking-offer-type">{serviceTitle}</p>
                                  <p className="booking-offer-description">{serviceDescription}</p>
                                  <span className="booking-offer-meta" title={statusText}>до 8 человек · 60 минут</span>
                                                                  </div>
                                <div className="booking-price-block booking-price-block--group">
                                  <strong>{servicePrice}</strong>
                                  <span>за занятие</span>
                                </div>
                                <button
                                  type="button"
                                  className="booking-action booking-action--group"
                                  title={statusText}
                                  disabled={raw === 'none'}
                                  onClick={() =>
                                    openForm({
                                      teacher: teacher.name,
                                      service: serviceTitle,
                                      price: servicePrice,
                                      spotsStatus:
                                        raw === 'many' || raw === 'few' || raw === 'none'
                                          ? raw
                                          : undefined,
                                    })
                                  }
                                >
                                  {raw === 'none' ? 'Нет мест' : 'Записаться'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <aside className="booking-trial-panel booking-trial-panel--group">
                        <span className="booking-or" aria-hidden="true">или</span>
                        <span className="booking-trial-mark" aria-hidden="true">☆</span>
                        <div>
                          <p className="booking-trial-kicker">Пробное занятие</p>
                          <strong className="booking-trial-price">
                            {typeof teacher.trialLesson?.price === 'string' && teacher.trialLesson?.price.trim()
                              ? teacher.trialLesson.price
                              : '15 BYN'}
                          </strong>
                          <p className="booking-trial-copy">
                            Познакомьтесь с наставником и форматом до старта
                          </p>
                        </div>
                        <button
                          type="button"
                          className="booking-action booking-action--group-secondary"
                          onClick={() =>
                            openForm({
                              teacher: teacher.name,
                              service: 'Пробное занятие',
                              price: teacher.trialLesson?.price || '15 BYN',
                            })
                          }
                        >
                          Попробовать занятие
                        </button>
                      </aside>
                    </div>
                  )}
                </article>
              ))}
              </div>
            <div className="booking-permanent-info">
              <section
                className="booking-trial-guide"
                aria-label="О пробном занятии"
                data-scroll-reveal
              >
                <span className="booking-trial-guide-icon" aria-hidden="true">i</span>
                <div className="booking-trial-guide-copy">
                  <h3>{trialGuideTitle}</h3>
                  <p>
                    {trialGuideLines.map((line, index) => (
                      <Fragment key={index}>
                        {index > 0 && <br />}
                        {line}
                      </Fragment>
                    ))}
                  </p>
                </div>
                <svg className="booking-trial-guide-art" viewBox="0 0 150 62" fill="none" aria-hidden="true">
                  <rect x="15" y="13" width="44" height="31" rx="3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M20 36l8-9 7 5 8-12 10 7" stroke="currentColor" strokeWidth="1.35" />
                  <circle cx="28" cy="25" r="2" stroke="currentColor" strokeWidth="1.1" />
                  <rect x="73" y="7" width="49" height="38" rx="3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M80 36V25m9 11V17m9 19V22m9 14V12m9 24V27" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M9 52h126" stroke="currentColor" strokeWidth="1.1" opacity=".58" />
                  <path d="M41 52l-4 6h56l-4-6" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M124 46l12 12M130 46l-6 12" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              </section>
              <section className="booking-benefits" aria-label="Преимущества обучения">
                {benefits.map((benefit, index) => (
                  <article className="booking-benefit" data-scroll-reveal key={benefit.title || index}>
                    <span className="booking-benefit-icon" aria-hidden="true">
                      {BENEFIT_ICONS[index % BENEFIT_ICONS.length]}
                    </span>
                    <div><h3>{benefit.title}</h3><p>{benefit.text}</p></div>
                  </article>
                ))}
              </section>
            </div>
          </div>
        </section>
        <div id="diagnostic">
          <DiagnosticSection
            eyebrow={diagnostic?.eyebrow}
            title={diagnostic?.title}
            text={diagnostic?.text}
            buttonText={diagnostic?.buttonText}
            steps={diagnosticSteps}
          />
        </div>
      </main>
    </div>
  );
}
