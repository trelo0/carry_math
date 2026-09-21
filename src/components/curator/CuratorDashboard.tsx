'use client';

import type { CuratorCabinetData } from '@/lib/curator/cabinet-data';
import { formatDateTime, sessionLabel, sessionPillClass } from './curator-utils';

type Props = {
  data: CuratorCabinetData;
  onOpenHomework: () => void;
  onOpenLesson: (id: string) => void;
  onOpenStudents: () => void;
};

export default function CuratorDashboard({
  data,
  onOpenHomework,
  onOpenLesson,
  onOpenStudents,
}: Props) {
  const { dashboard, courseTitle, students } = data;

  return (
    <div className="curator-panel curator-panel--wide">
      <header className="curator-page-head">
        <div>
          <p className="curator-kicker">Кабинет куратора</p>
          <h1 className="curator-title">{courseTitle}</h1>
          <p className="curator-muted">Управление эфирами, учениками и домашними заданиями</p>
        </div>
      </header>

      <div className="curator-stats curator-stats--hero">
        <article className="curator-stat-card">
          <span className="curator-stat-val">{dashboard.studentCount}</span>
          <span className="curator-stat-label">учеников на курсе</span>
          <button type="button" className="curator-stat-link" onClick={onOpenStudents}>
            Открыть список
          </button>
        </article>
        <article className="curator-stat-card is-accent">
          <span className="curator-stat-val">{dashboard.awaitingReview}</span>
          <span className="curator-stat-label">ДЗ на проверке</span>
          {dashboard.awaitingReview > 0 ? (
            <button type="button" className="curator-stat-link" onClick={onOpenHomework}>
              Проверить
            </button>
          ) : null}
        </article>
        <article className="curator-stat-card">
          <span className="curator-stat-val">{dashboard.liveNow}</span>
          <span className="curator-stat-label">эфиров сейчас</span>
        </article>
        <article className="curator-stat-card">
          <span className="curator-stat-val">{dashboard.upcomingCount}</span>
          <span className="curator-stat-label">запланировано</span>
        </article>
      </div>

      <div className="curator-dash-grid">
        {dashboard.liveLessons.length > 0 ? (
          <section className="curator-card curator-card--highlight">
            <h2>Сейчас в эфире</h2>
            <ul className="curator-mini-list">
              {dashboard.liveLessons.map((lesson) => (
                <li key={lesson.sanityId}>
                  <div>
                    <strong>№{lesson.lessonNumber} · {lesson.title}</strong>
                    <p className="curator-muted">{lesson.moduleTitle}</p>
                  </div>
                  <button type="button" className="curator-btn curator-btn-accent" onClick={() => onOpenLesson(lesson.sanityId)}>
                    Управлять
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="curator-card">
          <h2>Последнее проведённое</h2>
          {dashboard.lastLesson ? (
            <>
              <p className="curator-lesson-name">
                №{dashboard.lastLesson.lessonNumber} · {dashboard.lastLesson.title}
              </p>
              <p className="curator-muted">{dashboard.lastLesson.moduleTitle}</p>
              <p>{formatDateTime(dashboard.lastLesson.endedAt ?? dashboard.lastLesson.scheduledAt)}</p>
              <span className={`curator-pill ${sessionPillClass(dashboard.lastLesson.sessionStatus)}`}>
                {sessionLabel(dashboard.lastLesson.sessionStatus)}
              </span>
              <button
                type="button"
                className="curator-btn curator-btn-ghost"
                onClick={() => onOpenLesson(dashboard.lastLesson!.sanityId)}
              >
                Открыть занятие
              </button>
            </>
          ) : (
            <p className="curator-muted">Пока нет завершённых занятий.</p>
          )}
        </section>

        <section className="curator-card">
          <h2>Ближайшее занятие</h2>
          {dashboard.nextLesson ? (
            <>
              <p className="curator-lesson-name">
                №{dashboard.nextLesson.lessonNumber} · {dashboard.nextLesson.title}
              </p>
              <p className="curator-muted">{dashboard.nextLesson.moduleTitle}</p>
              <p>{formatDateTime(dashboard.nextLesson.scheduledAt)}</p>
              <span className={`curator-pill ${sessionPillClass(dashboard.nextLesson.sessionStatus)}`}>
                {sessionLabel(dashboard.nextLesson.sessionStatus)}
              </span>
              <button
                type="button"
                className="curator-btn"
                onClick={() => onOpenLesson(dashboard.nextLesson!.sanityId)}
              >
                Открыть занятие
              </button>
            </>
          ) : (
            <p className="curator-muted">Ближайших занятий пока нет.</p>
          )}
        </section>

        <section className="curator-card">
          <h2>Домашние задания</h2>
          <ul className="curator-kv-list">
            <li><span>На проверке</span><strong>{dashboard.awaitingReview}</strong></li>
            <li><span>На доработке</span><strong>{dashboard.revision}</strong></li>
            <li><span>Не сдано</span><strong>{dashboard.notSubmitted}</strong></li>
          </ul>
          <button type="button" className="curator-btn curator-btn-ghost" onClick={onOpenHomework}>
            Все домашние задания
          </button>
        </section>

        <section className="curator-card">
          <h2>Ученики</h2>
          {students.length === 0 ? (
            <p className="curator-muted">Пока нет учеников с доступом к курсу.</p>
          ) : (
            <ul className="curator-mini-list">
              {students.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="curator-muted">
                      Прогресс {s.progressPercent}% · ❤️ {s.livesCurrent ?? '—'}/{s.livesMax ?? '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="curator-btn curator-btn-ghost" onClick={onOpenStudents}>
            Все ученики
          </button>
        </section>
      </div>
    </div>
  );
}
