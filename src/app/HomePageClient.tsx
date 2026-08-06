"use client";

import { useEffect, useRef, useState } from 'react';
import { TeacherCard } from '@/components';
import TeacherReviewsBlock from '@/components/ui/TeacherReviewsBlock';
import DiagnosticSection from '@/components/ui/DiagnosticSection';
import { Principle, ProcessStep, Stat, Teacher } from '@/data/types';
import { HomePageContent, SiteSettings } from '@/lib/studio/sanityData';
import { normalizeBrandName } from '@/lib/brand';

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function renderHeroHeadline(title: string) {
  const accentPattern = /(победител[а-яё]*\.?)/gi;

  return title.split('\n').map((line, idx) => {
    if (!accentPattern.test(line)) {
      return (
        <span key={idx}>
          {line}
          <br />
        </span>
      );
    }

    const parts = line.split(accentPattern);
    return (
      <span key={idx}>
        {parts.map((part, pidx) =>
          /победител[а-яё]*\.?/i.test(part) ? (
            <span key={pidx} className="accent">
              {part}
            </span>
          ) : (
            <span key={pidx}>{part}</span>
          ),
        )}
        <br />
      </span>
    );
  });
}

function renderTitleWithAccent(title: string) {
  const parts = title.split(/(наставники)/i);

  return parts.map((part, idx) =>
    /наставники/i.test(part) ? (
      <span key={idx} className="accent">
        {part}
      </span>
    ) : (
      <span key={idx}>{part}</span>
    ),
  );
}

function useRevealOnIntersect() {
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduceMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -100px 0px' },
    );

    document.querySelectorAll('.process-step-alt, .principle-item').forEach((item) => {
      observer.observe(item);
    });

    return () => observer.disconnect();
  }, []);
}

export default function HomePageClient({
  home,
  teachers,
  stats,
  principles,
  processSteps,
  siteSettings,
}: {
  home: HomePageContent | null;
  teachers: Teacher[];
  stats: Stat[];
  principles: Principle[];
  processSteps: ProcessStep[];
  siteSettings?: SiteSettings | null;
}) {
  useRevealOnIntersect();

  const [expandedTeacherId, setExpandedTeacherId] = useState<string | null>(null);
  const teachersGridRef = useRef<HTMLDivElement>(null);
  const syncTimeoutRef = useRef<number | null>(null);

  const measureTeacherCards = () => {
    const grid = teachersGridRef.current;
    if (!grid) return;
    // never measure while a card is expanded — it would skew the shared height
    if (grid.querySelector('.teacher-card--expanded')) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.teacher-card'));
    if (!cards.length) return;
    grid.style.removeProperty('--teacher-card-min-h');
    const maxHeight = Math.max(...cards.map((card) => card.getBoundingClientRect().height));
    grid.style.setProperty('--teacher-card-min-h', `${Math.ceil(maxHeight)}px`);
  };

  useEffect(() => {
    measureTeacherCards();
    document.fonts?.ready.then(() => measureTeacherCards()).catch(() => {});
    window.addEventListener('resize', measureTeacherCards);
    return () => {
      window.removeEventListener('resize', measureTeacherCards);
      if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTeacherToggle = (teacherId: string, value: boolean) => {
    if (syncTimeoutRef.current) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    setExpandedTeacherId(value ? teacherId : null);
    if (!value) {
      // re-measure only after the collapse animation finishes
      syncTimeoutRef.current = window.setTimeout(measureTeacherCards, 400);
    }
  };

  if (!home) {
    throw new Error('Missing homePage content');
  }

  const heroEyebrow = home.heroEyebrow ?? 'Онлайн-школа District';
  const siteTitle = normalizeBrandName(siteSettings?.title);
  const stripSuffix = (text: string, suffix: string) =>
    text.toLowerCase().endsWith(suffix.toLowerCase())
      ? text.slice(0, -suffix.length).trim()
      : text;
  let eyebrowLine = stripSuffix(heroEyebrow, siteTitle);
  eyebrowLine = stripSuffix(eyebrowLine, 'district');
  eyebrowLine = stripSuffix(eyebrowLine, 'distrikt');
  const heroTitle = home.heroTitle ?? 'Готовим победителей.\nНе выживших.';
  const heroDescription = home.heroDescription ?? '';
  const heroButtonText = siteSettings?.heroButtonText ?? 'Наши наставники';

  const rawTeachersTitle = home.sectionTeachersTitle ?? 'Наши наставники';
  const teachersTitle = rawTeachersTitle.toLowerCase().includes('выбери')
    ? 'Наши наставники'
    : rawTeachersTitle;
  const teachersSubtitle =
    home.sectionTeachersSubtitle?.trim() || 'Выбери своего и начни побеждать.';

  const principlesTitle = home.sectionPrinciplesTitle ?? '';
  const principlesSubtitle = home.sectionPrinciplesSubtitle ?? '';

  const processTitle = home.sectionProcessTitle ?? '';
  const processSubtitle = home.sectionProcessSubtitle ?? '';

  return (
    <>
      <div className="city-backdrop" aria-hidden="true" />
      <section className="hero" id="hero">
        <div className="hero-bg" aria-hidden="true" />
        <div className="container hero-content">
          <p className="hero-eyebrow">{eyebrowLine}</p>
          <div className="hero-brand">{siteTitle}</div>
          <h1 className="hero-headline">
            {renderHeroHeadline(heroTitle)}
          </h1>
          <div className="hero-bottom">
            <p className="hero-description">{heroDescription}</p>
            <a href="#teachers" className="btn btn-primary hero-cta">
              {heroButtonText}
            </a>
          </div>
        </div>
      </section>

      <main className="site-main">
        <section className="section section-teachers" id="teachers">
          <div className="container">
            <div className="section-title">
              <h2>{renderTitleWithAccent(teachersTitle)}</h2>
              {teachersSubtitle ? <p>{teachersSubtitle}</p> : null}
            </div>

            <div
              ref={teachersGridRef}
              className={`teachers-grid teachers-${teachers.length}`}
            >
              {teachers.map((teacher) => (
                <div key={teacher._id} className="teacher-column">
                  <TeacherCard
                    teacher={teacher}
                    buttonText={siteSettings?.teacherCardButtonText}
                    expanded={expandedTeacherId === teacher._id}
                    onToggle={(value) => handleTeacherToggle(teacher._id, value)}
                  />
                  <TeacherReviewsBlock teacher={teacher} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-principles" id="principles">
          <div className="container">
            {stats.length > 0 && (
              <div className="stats-ribbon">
                {stats.map((stat) => (
                  <div key={stat._id} className="stat-card">
                    <span className="stat-value">{stat.value}</span>
                    <span className="stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="principles-layout">
              <div className="principles-header">
                <h2>{principlesTitle}</h2>
                {principlesSubtitle ? <p>{principlesSubtitle}</p> : null}
              </div>

              <div className="principles-list">
                {principles.map((principle, index) => (
                  <div key={principle._id} className="principle-item">
                    <span className="principle-numeral">{ROMAN_NUMERALS[index] ?? index + 1}</span>
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

        <section className="section section-process" id="process">
          <div className="process-section-wrapper">
            <div className="container">
              <div className="process-header-new">
                <h2>{processTitle}</h2>
                {processSubtitle ? <p>{processSubtitle}</p> : null}
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
                    <div className="step-alt-card">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                      <div className="step-alt-number">{String(index + 1).padStart(2, '0')}</div>
                    </div>
                    <div className="step-alt-dot"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <DiagnosticSection
          eyebrow={home.diagnosticEyebrow}
          title={home.diagnosticTitle}
          text={home.diagnosticText}
          buttonText={home.diagnosticButtonText}
          steps={home.diagnosticSteps}
        />
      </main>
    </>
  );
}
