export function CabSkelSpinner({ label }: { label?: string }) {
  return (
    <div className="cab-skel-spinner-wrap" role="status" aria-live="polite">
      <span className="cab-skel-spinner" aria-hidden="true" />
      {label ? <span className="cab-skel-spinner-label">{label}</span> : null}
    </div>
  );
}

function CabSkelLine({
  className = '',
  wide,
}: {
  className?: string;
  wide?: boolean;
}) {
  return (
    <span
      className={`cab-skel-line${wide ? ' cab-skel-line--wide' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}

function CabSkelRoadmap() {
  return (
    <div className="cab-skel-roadmap" aria-hidden="true">
      <svg viewBox="0 0 720 320" preserveAspectRatio="xMidYMid meet">
        <path
          className="cab-skel-roadmap-path"
          d="M 48 268 C 120 248, 140 180, 210 188 S 320 120, 380 132 S 480 52, 560 68 S 640 28, 672 40"
          fill="none"
        />
        {[
          [48, 268],
          [210, 188],
          [380, 132],
          [560, 68],
          [672, 40],
        ].map(([cx, cy], i) => (
          <circle key={i} className="cab-skel-roadmap-node" cx={cx} cy={cy} r={i === 4 ? 10 : 8} />
        ))}
      </svg>
    </div>
  );
}

/** Правый сайдбар кабинета при загрузке. */
export function CabinetBootAside() {
  return (
    <aside className="cab-aside cab-aside--boot" aria-hidden="true">
      <section className="cab-panel cab-profile">
        <header className="cab-panel-head cab-profile-head">
          <h3>Профиль</h3>
        </header>
        <div className="cab-profile-row cab-skel-profile-row">
          <span className="cab-skel-glass cab-skel-avatar" />
          <div className="cab-skel-profile-copy">
            <CabSkelLine className="cab-skel-line--profile-name" wide />
            <CabSkelLine className="cab-skel-line--xs" />
          </div>
        </div>
      </section>

      <section className="cab-panel cab-skel-glass cab-skel-achieve-panel">
        <CabSkelLine className="cab-skel-line--card-title" wide />
        <div className="cab-skel-achieve-rail">
          <span className="cab-skel-glass cab-skel-achieve-card" />
          <span className="cab-skel-glass cab-skel-achieve-card cab-skel-achieve-card--dim" />
        </div>
      </section>

      <section className="cab-panel cab-help">
        <header className="cab-panel-head cab-help-head">
          <h3>Поддержка</h3>
        </header>
        <div className="cab-skel-help">
          <CabSkelLine />
          <CabSkelLine className="cab-skel-line--short" />
        </div>
      </section>

      <div className="cab-aside-quote cab-skel-quote">
        <CabSkelLine />
        <CabSkelLine className="cab-skel-line--short" />
      </div>
    </aside>
  );
}

/** Основная зона курса (boot / переключение курса). */
export function CabinetCourseLoadBody() {
  return (
    <div className="cab-stack cab-course-screen cab-skel-screen">
      <div className="cab-mycourses cab-mycourses--skel" aria-hidden="true">
        <div className="cab-skel-line cab-skel-line--chip" />
        <div className="cab-skel-course-rail">
          <div className="cab-skel-glass cab-skel-course-card" />
          <div className="cab-skel-glass cab-skel-course-card cab-skel-course-card--dim" />
        </div>
      </div>

      <section className="cab-panel cab-course-shell cab-skel-course-panel">
        <div className="cab-skel-hero">
          <div className="cab-skel-glass cab-skel-hero-cover" />
          <div className="cab-skel-hero-copy">
            <CabSkelLine className="cab-skel-line--title" wide />
            <CabSkelLine />
            <CabSkelLine className="cab-skel-line--short" />
          </div>
        </div>

        <div className="cab-skel-tabs" aria-hidden="true">
          <span className="cab-skel-tab is-active" />
          <span className="cab-skel-tab" />
        </div>

        <div className="cab-course-map-block">
          <div className="cab-skel-map-head">
            <CabSkelLine className="cab-skel-line--section" wide />
            <div className="cab-skel-map-meta">
              <CabSkelLine className="cab-skel-line--xs" />
              <CabSkelLine className="cab-skel-line--pct" />
            </div>
          </div>
          <div className="cab-skel-glass cab-skel-map-frame">
            <CabSkelRoadmap />
          </div>
          <div className="cab-skel-legend">
            <span className="cab-skel-legend-item" />
            <span className="cab-skel-legend-item" />
            <span className="cab-skel-legend-item" />
          </div>
        </div>

        <CabSkelSpinner label="Подгружаем данные курса" />
      </section>
    </div>
  );
}

/** Страница занятия. */
export function CabinetLessonLoadBody() {
  return (
    <div className="cab-lespage">
      <div className="cab-lespage-inner">
        <header className="cab-lespage-head">
          <span className="cab-lespage-back cab-lespage-back--placeholder">← Кабинет курса</span>
          <CabSkelLine className="cab-skel-line--k" />
          <CabSkelLine className="cab-skel-line--lesson-title" wide />
        </header>

        <div className="cab-lespage-content">
          <div className="cab-skel-glass cab-skel-lesson-video">
            <CabSkelSpinner label="Открываем занятие" />
          </div>

          {(['about', 'materials', 'homework'] as const).map((area) => (
            <div
              key={area}
              className={`cab-skel-glass cab-skel-lesson-card cab-skel-lesson-card--${area}`}
            >
              <CabSkelLine className="cab-skel-line--card-title" wide />
              <CabSkelLine />
              <CabSkelLine className="cab-skel-line--short" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
