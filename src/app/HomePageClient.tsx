"use client";

import { useEffect, useRef, useState } from 'react';
import DiagnosticSection from '@/components/ui/DiagnosticSection';
import AtmosphereLayers from '@/components/ui/AtmosphereLayers';
import { useForm } from '@/contexts/FormContext';
import { Principle, ProcessStep, Stat, Teacher } from '@/data/types';
import { HomePageContent, SiteSettings } from '@/lib/studio/sanityData';
import { urlFor } from '@/lib/studio/sanityImage';

const SOLO_PERKS = [
  'Программа строится под твою цель и стартовый уровень',
  'Гибкий график — занятия когда удобно, даже вечером',
  'Максимальное внимание наставника всё занятие',
  'Личный куратор и разбор каждой ошибки 24/7',
];

const GROUP_PERKS = [
  'Цена ниже, качество подготовки то же',
  'Командный рейтинг и совместные квесты',
  'Игровая мотивация: уровни, лиги, награды',
  'Занятия в мини-группе до 5 человек',
];

type Format = 'solo' | 'group';
type VsFocus = 'solo' | 'group' | null;

const SOLO_MATCH = /индивиду|соло|solo|1-на-1/i;
const GROUP_MATCH = /групп|команд|squad/i;

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
  const { openForm } = useForm();
  const [format, setFormat] = useState<Format>('solo');

  const handleFormat = (next: Format) => {
    if (next !== format) setFormat(next);
  };
  const [vsFocus, setVsFocus] = useState<VsFocus>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const targets = Array.from(
      document.querySelectorAll('[data-reveal], .principle-item, .process-step-alt'),
    );
    if (targets.length === 0) return;

    if (reduceMotion) {
      targets.forEach((el) => {
        el.classList.add('revealed');
        el.classList.add('visible');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  if (!home) {
    throw new Error('Missing homePage content');
  }

  const heroDescription =
    home.heroDescription ||
    'Индивидуальные уроки один на один с наставником и мини-группы до 5 человек — выбери свой формат и идём к цели вместе.';

  const principlesTitle = home.sectionPrinciplesTitle || 'Принципы гильдии';
  const principlesSubtitle = home.sectionPrinciplesSubtitle || '';
  const processTitle = home.sectionProcessTitle || 'Как проходит обучение';
  const processSubtitle = home.sectionProcessSubtitle || '';

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
        <div className="container hero-content">
          <div className="ind-hero-grid">
            <div className="ind-hero-left">
              <a className="crumb" href="/">
                ← District · главная
              </a>
              <span className="section-kicker">
                ФОРМАТЫ ЗАНЯТИЙ // 5–11 КЛАСС
              </span>
              <h1 className="ind-hero-title">
                Занятия с наставником <span className="gold">гильдии</span>
              </h1>
              <p className="ind-hero-desc">{heroDescription}</p>
            </div>

            <aside className="ind-hero-panel" aria-label="Выбор формата занятий">
              <p className="ind-panel-title">Выбор пути</p>
              <a className="ind-slot" href="#formats-solo">
                <span className="ind-slot-icon" aria-hidden="true">🗡</span>
                <span className="ind-slot-text">
                  <b>Одиночный рейд</b>
                  <small>индивидуальные · 5–11 класс</small>
                </span>
                <span className="ind-slot-arrow" aria-hidden="true">→</span>
              </a>
              <a className="ind-slot" href="#formats-group">
                <span className="ind-slot-icon" aria-hidden="true">🛡</span>
                <span className="ind-slot-text">
                  <b>Командный сектор</b>
                  <small>мини-группы до 5 · 5–10 класс</small>
                </span>
                <span className="ind-slot-arrow" aria-hidden="true">→</span>
              </a>
            </aside>
          </div>
        </div>
      </section>

      <main className="site-main">
        {/* ---------- Наставник: карточка персонажа ---------- */}
        <section className="main-teacher" id="teachers" data-reveal>
          <span className="watermark" aria-hidden="true">MENTOR</span>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              КВЕСТ 01 // ОТРЯД ГИЛЬДИИ :: SELECT
            </span>
            <h2 className="main-teacher-title">Выбери наставника</h2>

            <div className="teacher-rows">
              {teachers.map((teacher, index) => (
                <article className="teacher-row" key={teacher._id}>
                  <div className="teacher-row-photo">
                    
                    {teacher.photo ? (
                      <img
                        src={urlFor(teacher.photo).width(480).url()}
                        alt={`${teacher.name} — наставник по математике`}
                      />
                    ) : null}
                  </div>
                  <div className="teacher-row-body" data-index={String(index + 1).padStart(2, '0')}>
                    <p className="select-name">{teacher.name}</p>
                    <p className="select-role">Наставник гильдии · {teacher.subject}</p>
                    
                    <p className="select-desc">{teacher.description}</p>
                    <ul className="select-chips" aria-label="Достижения наставника">
                      <li>❖ 98 баллов ЦТ</li>
                      <li>❖ 4 года опыта</li>
                      <li>❖ БГУ, мехмат</li>
                    </ul>
                  </div>
                </article>
              ))}
            </div>

          </div>
        </section>

        {/* ---------- Принципы ---------- */}
        <section className="section section-principles ind-principles" id="principles" data-reveal>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              КВЕСТ 02 // СТАТИСТИКА + ПРИНЦИПЫ :: CODE
            </span>

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
                {principles.map((principle) => (
                  <div key={principle._id} className="principle-item">
                    <span className="principle-numeral">❖</span>
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
        <section className="main-paths ind-formats-vs" data-reveal>
          <span className="watermark" aria-hidden="true">VS</span>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              КВЕСТ 03 // ВАРИАНТЫ ЗАНЯТИЙ :: VS MODE
            </span>
            <h2 className="main-section-title">Соло или команда?</h2>

            <div
              className={'vs-split' + (vsFocus ? ' vs-split--' + vsFocus + '-focus' : '')}
            >
              <div
                className="vs-side vs-side--solo"
                id="formats-solo"
                onMouseEnter={() => setVsFocus('solo')}
                onMouseLeave={() => setVsFocus(null)}
                onPointerEnter={() => setVsFocus('solo')}
                onPointerLeave={() => setVsFocus(null)}
                onFocus={() => setVsFocus('solo')}
                onBlur={() => setVsFocus(null)}
              >
                <h3 className="vs-title">🗡 Одиночный рейд</h3>
                <p className="vs-sub">индивидуальные · 5–11 класс</p>
                <p className="vs-desc">
                  Личный маршрут по математике: программа, темп и фокус — только
                  под тебя. Наставник ведёт от диагностики до экзамена.
                </p>
                <ul className="vs-perks">
                  {SOLO_PERKS.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <a className="mini-cta mini-cta--blue" href="#signup" onClick={() => setFormat('solo')}>
                  Записаться на соло
                </a>
              </div>

              <div className="vs-axis" aria-hidden="true">
                <span className={'vs-badge' + (vsFocus ? ' vs-badge--rotated' : '')}>VS</span>
              </div>

              <div
                className="vs-side vs-side--group"
                id="formats-group"
                onMouseEnter={() => setVsFocus('group')}
                onMouseLeave={() => setVsFocus(null)}
                onPointerEnter={() => setVsFocus('group')}
                onPointerLeave={() => setVsFocus(null)}
                onFocus={() => setVsFocus('group')}
                onBlur={() => setVsFocus(null)}
              >
                <h3 className="vs-title">🛡 Командный сектор</h3>
                <p className="vs-sub">мини-группы до 5 · 5–10 класс</p>
                <p className="vs-desc">
                  Мини-отряд единомышленников: общий рейтинг, командные квесты
                  и дух соревнования. Качество то же, цена ниже.
                </p>
                <ul className="vs-perks">
                  {GROUP_PERKS.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <a className="mini-cta" href="#signup" onClick={() => setFormat('group')}>Записаться в группу</a>
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
        <section className="section section-process ind-section" id="process" data-reveal>
          <div className="process-section-wrapper">
            <div className="container">
              <span className="section-kicker section-kicker--center">
                КВЕСТ 04 // КАК ПРОХОДИТ ОБУЧЕНИЕ :: ПРОТОКОЛ
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

        {/* ---------- Запись: таб формата + цены ---------- */}
        <section className="main-init ind-signup" id="signup" data-reveal data-format={format}>
          <span className="watermark watermark--left" aria-hidden="true">START</span>
          <div className="container">
            <span className="section-kicker section-kicker--center">
              КВЕСТ 05 // ЗАПИСЬ :: START QUEST
            </span>
            <h2 className="main-init-title">
              Время выбрать <span className="gold">свой путь</span>
            </h2>
            <div className="format-tabs" role="tablist" aria-label="Форматы занятий">
              <button
                type="button"
                role="tab"
                aria-selected={format === 'solo'}
                className={'format-tab' + (format === 'solo' ? ' format-tab--active' : '')}
                onClick={() => handleFormat('solo')}
              >
                🗡 Одиночный рейд
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={format === 'group'}
                className={'format-tab' + (format === 'group' ? ' format-tab--active' : '')}
                onClick={() => handleFormat('group')}
              >
                🛡 Командный сектор
              </button>
            </div>
            <div className={'signup-body booking-stage booking-stage--' + format}>
              {teacherServices.map(({ teacher, soloServices, groupServices }) => (
                <article
                  className={'booking-format-card booking-format-card--' + format}
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
              <section className="booking-trial-guide" aria-label="О пробном занятии">
                <span className="booking-trial-guide-icon" aria-hidden="true">i</span>
                <div className="booking-trial-guide-copy">
                  <h3>Пробное занятие — первый шаг</h3>
                  <p>Пробное занятие необходимо для начала индивидуальных занятий.<br />Оно поможет определить уровень и подобрать подходящую программу.</p>
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
                <article className="booking-benefit">
                  <span className="booking-benefit-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6"/><path d="M8.6 12l2.1 2.1 4.8-5" stroke="currentColor" strokeWidth="1.6"/></svg>
                  </span>
                  <div><h3>Профессиональные</h3><p>опытные преподаватели</p></div>
                </article>
                <article className="booking-benefit">
                  <span className="booking-benefit-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9L7 7m10 10l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="currentColor" strokeWidth="1.3"/></svg>
                  </span>
                  <div><h3>Индивидуальный подход</h3><p>программа под ваши цели</p></div>
                </article>
                <article className="booking-benefit">
                  <span className="booking-benefit-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7.5 3v5m9-5v5M3.5 10h17M8 14h2m4 0h2M8 17h2m4 0h2" stroke="currentColor" strokeWidth="1.35"/></svg>
                  </span>
                  <div><h3>Удобный график</h3><p>занимайтесь в комфортное время</p></div>
                </article>
              </section>
            </div>
          </div>
        </section>
        <div id="diagnostic">
          <DiagnosticSection
            eyebrow={home.diagnosticEyebrow}
            title={home.diagnosticTitle}
            text={home.diagnosticText}
            buttonText={home.diagnosticButtonText}
            steps={home.diagnosticSteps}
          />
        </div>
      </main>
    </div>
  );
}
