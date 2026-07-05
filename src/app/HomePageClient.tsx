"use client";

import { useEffect } from 'react';
import { TeacherCard } from '@/components';
import TeacherReviewsBlock from '@/components/ui/TeacherReviewsBlock';
import { Course, MethodStep, Problem, ProcessStep, Teacher } from '@/data/types';
import { HomePageContent, SiteSettings } from '@/lib/studio/sanityData';

function useParallaxShapes() {
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduceMotion) return;

    const shapes = document.querySelectorAll<HTMLElement>('.shape-sphere');

    const handleParallax = () => {
      const scrollY = window.scrollY;
      shapes.forEach((shape) => {
        const speed = parseFloat(shape.dataset.speed || '0.5');
        const yPos = -(scrollY * speed);
        shape.style.transform = `translate3d(0, ${yPos}px, 0)`;
      });
    };

    window.addEventListener('scroll', handleParallax);
    return () => window.removeEventListener('scroll', handleParallax);
  }, []);
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

    const processItems = document.querySelectorAll('.process-step-alt');
    processItems.forEach((item) => observer.observe(item));

    const problemItems = document.querySelectorAll('.problem-card-new');
    problemItems.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, []);
}

export default function HomePageClient({
  home,
  courses,
  teachers,
  methodSteps,
  processSteps,
  problems,
  siteSettings,
}: {
  home: HomePageContent | null;
  courses: Course[];
  teachers: Teacher[];
  methodSteps: MethodStep[];
  processSteps: ProcessStep[];
  problems: Problem[];
  siteSettings?: SiteSettings | null;
}) {
  useParallaxShapes();
  useRevealOnIntersect();

  if (!home) {
    throw new Error('Missing homePage content');
  }

  const heroTitle = home.heroTitle ?? '';
  const heroDescription = home.heroDescription ?? '';
  const heroButtonText = siteSettings?.heroButtonText ?? 'Записаться на занятие';

  const problemsTitle = home.sectionProblemsTitle ?? '';
  const problemsSubtitle = home.sectionProblemsSubtitle ?? '';

  const methodTitle = home.sectionMethodTitle ?? '';
  const methodSubtitle = home.sectionMethodSubtitle ?? '';

  const coursesTitle = home.sectionCoursesTitle ?? '';
  const coursesSubtitle = home.sectionCoursesSubtitle ?? '';

  const teachersTitle = home.sectionTeachersTitle ?? '';
  const teachersSubtitle = home.sectionTeachersSubtitle ?? '';

  const processTitle = home.sectionProcessTitle ?? '';
  const processSubtitle = home.sectionProcessSubtitle ?? '';

  return (
    <>
      <section className="hero" id="hero">
        <div className="hero-shapes">
          <div className="shape shape-sphere shape-powder" data-speed="0.3"></div>
          <div className="shape shape-sphere shape-mint" data-speed="0.5"></div>
          <div className="shape shape-sphere shape-sand" data-speed="0.2"></div>
          <div className="shape shape-sphere shape-lavender" data-speed="0.7"></div>
        </div>

        <div className="hero-content">
          <h1>
            {heroTitle.split('\n').map((line, idx) => (
              <span key={idx}>
                {line}
                <br />
              </span>
            ))}
          </h1>
          <p className="hero-description">{heroDescription}</p>
          <div className="hero-buttons">
            <a href="#teachers" className="btn btn-primary">
              {heroButtonText}
            </a>
          </div>
        </div>
      </section>

      <div className="hero-connector">
        <div className="connector-circle"></div>
      </div>

      <main className="site-main">
        <section className="section-secondary problems-method-section" id="problems-method">
          <div className="problems-method-container">
            <div className="problems-method-header">
              <h2>{problemsTitle}</h2>
              <p>{problemsSubtitle}</p>
            </div>

            <div className="problems-cards-row">
              {problems.map((problem, index) => (
                <div key={problem._id} className="problem-card-new">
                  <div className="problem-number">{String(index + 1).padStart(2, '0')}</div>
                  <div className="problem-content">
                    <h4>{problem.title}</h4>
                    <p>{problem.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="method-bottom-wrapper">
              <div className="method-left-header">
                <h3>{methodTitle}</h3>
                <p>{methodSubtitle}</p>
              </div>

              <div className="method-steps-connected">
                {methodSteps.map((step, index) => (
                  <div key={step._id} className="method-step-connected">
                    <div className="step-connector">
                      <span className="step-num">{index + 1}</span>
                      {index < methodSteps.length - 1 && <div className="connector-line"></div>}
                    </div>
                    <div className="step-details">
                      <h4>{step.title}</h4>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="teachers">
          <div className="container">
            <div className="section-title">
              <h2>{teachersTitle}</h2>
              <p>{teachersSubtitle}</p>
            </div>

            <div className={`teachers-grid teachers-${teachers.length}`}>
              {teachers.map((teacher) => (
                <TeacherCard key={teacher._id} teacher={teacher} buttonText={siteSettings?.teacherCardButtonText} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="reviews">
          <div className="container">
            <div className="section-title">
              <h2>Отзывы</h2>
              <p>Они просто скрины, но зато настоящие 🙂</p>
            </div>
            <div className="teachers-reviews-grid">
              {teachers.map((teacher) => (
                <TeacherReviewsBlock key={`reviews-${teacher._id}`} teacher={teacher} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="courses">
          <div className="container">
            <div className="section-title">
              <h2>{coursesTitle}</h2>
              <p>{coursesSubtitle}</p>
            </div>

            <div className={`courses-description courses-${courses.length}`}>
              {courses.map((course) => (
                <div 
                  key={course._id} 
                  className="course-desc-item"
                  onMouseMove={(e) => {
                    const card = e.currentTarget;
                    const icon = card.querySelector('.course-desc-icon') as HTMLElement;
                    if (!icon) return;
                    
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const cardWidth = rect.width;
                    const isLeftSide = x < cardWidth / 2;
                    
                    icon.style.transform = isLeftSide 
                      ? 'scale(1.1) rotate(-8deg)' 
                      : 'scale(1.1) rotate(8deg)';
                  }}
                  onMouseLeave={(e) => {
                    const icon = e.currentTarget.querySelector('.course-desc-icon') as HTMLElement;
                    if (icon) icon.style.transform = '';
                  }}
                >
                  <div className="course-desc-icon">{course.icon}</div>
                  <div className="course-desc-text">
                    <h3>{course.title}</h3>
                    <p>{course.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-process" id="process">
          <div className="process-section-wrapper">
            <div className="process-shapes">
              <div className="process-shape process-shape-1"></div>
              <div className="process-shape process-shape-2"></div>
              <div className="process-shape process-shape-3"></div>
              <div className="process-shape process-shape-4"></div>
              <div className="process-shape process-shape-5"></div>
            </div>

            <div className="container">
              <div className="process-header-new">
                <h2>{processTitle}</h2>
                <p>{processSubtitle}</p>
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
      </main>
    </>
  );
}
