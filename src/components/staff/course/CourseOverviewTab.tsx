'use client';

import { useMemo } from 'react';
import type { CuratorCabinetData, CuratorLessonView } from '@/lib/curator/cabinet-data';
import {
  curatorLessonDisplayNo,
  sessionLabel,
  sessionPillClass,
} from '@/components/curator/curator-utils';
import {
  IconCalendarRef,
  IconCheckRef,
  IconChevronRightRef,
  IconClockRef,
  IconUsersRef,
  IconVideoRef,
} from '../schedule/ScheduleRefIcons';
import {
  courseLessonStats,
  isLessonUpcoming,
  lessonDateParts,
  lessonFullDate,
  lessonTime,
} from './course-utils';

type Props = {
  data: CuratorCabinetData;
  onOpenLesson: (id: string) => void;
};

function ProgressRing({ percent }: { percent: number }) {
  const r = 46;
  const len = 2 * Math.PI * r;
  return (
    <div className="cr-ring" role="img" aria-label={`Прогресс курса ${percent}%`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="cr-ring-bg" cx="60" cy="60" r={r} />
        <circle
          className="cr-ring-fg"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={`${(len * percent) / 100} ${len}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <strong>{percent}%</strong>
    </div>
  );
}

function NextLessonHero({
  lesson,
  onOpen,
}: {
  lesson: CuratorLessonView | null;
  onOpen: (id: string) => void;
}) {
  if (!lesson) {
    return (
      <section className="cr-next cr-next--empty">
        <span className="cr-kicker">Следующее занятие</span>
        <p className="cr-empty cr-empty--inline">Запланированных занятий нет.</p>
      </section>
    );
  }
  const live = lesson.sessionStatus === 'live';
  const parts = lessonDateParts(lesson.scheduledAt);
  return (
    <section className={`cr-next${live ? ' is-live' : ''}`}>
      <div className="cr-next-date" aria-hidden="true">
        {parts ? (
          <>
            <strong>{parts.day}</strong>
            <em>{parts.month}</em>
            <small>{parts.weekday}</small>
          </>
        ) : (
          <>
            <IconCalendarRef size={26} />
            <small>без даты</small>
          </>
        )}
      </div>
      <div className="cr-next-main">
        <span className="cr-kicker">{live ? 'Сейчас в эфире' : 'Следующее занятие'}</span>
        <h3 className="cr-next-title">
          Урок {curatorLessonDisplayNo(lesson)}. {lesson.title}
        </h3>
        <div className="cr-meta-row">
          {lesson.moduleTitle ? <span className="cr-meta">{lesson.moduleTitle}</span> : null}
          <span className="cr-meta">
            <IconCalendarRef size={14} />
            {lessonFullDate(lesson.scheduledAt)}
          </span>
          <span className="cr-meta">
            <IconClockRef size={14} />
            {lessonTime(lesson.scheduledAt)}
          </span>
          <span className={`cr-pill ${sessionPillClass(lesson.sessionStatus)}`}>
            {sessionLabel(lesson.sessionStatus)}
          </span>
        </div>
      </div>
      <button type="button" className="cr-btn cr-btn--primary cr-next-cta" onClick={() => onOpen(lesson.sanityId)}>
        {live ? <IconVideoRef size={16} /> : null}
        {live ? 'Управлять эфиром' : 'Настроить занятие'}
      </button>
    </section>
  );
}

export default function CourseOverviewTab({ data, onOpenLesson }: Props) {
  const stats = useMemo(() => courseLessonStats(data.lessons), [data.lessons]);
  const { dashboard } = data;

  const lastLesson = useMemo(() => {
    if (dashboard.lastLesson) return dashboard.lastLesson;
    const done = data.lessons.filter((l) => l.sessionStatus === 'completed');
    return done.length > 0 ? done[done.length - 1] : null;
  }, [dashboard.lastLesson, data.lessons]);

  const nextLesson = useMemo(
    () =>
      dashboard.liveLessons[0] ??
      dashboard.nextLesson ??
      data.lessons.find(isLessonUpcoming) ??
      null,
    [dashboard.liveLessons, dashboard.nextLesson, data.lessons],
  );

  const studentCount = dashboard.studentCount ?? data.students.length;
  const lastParts = lastLesson ? lessonDateParts(lastLesson.endedAt ?? lastLesson.scheduledAt) : null;

  return (
    <div className="cr-overview">
      <div className="cr-ov-top">
        <NextLessonHero lesson={nextLesson} onOpen={onOpenLesson} />
        <section className="cr-ov-progress">
          <ProgressRing percent={stats.percent} />
          <div className="cr-ov-progress-text">
            <span className="cr-kicker">Прогресс курса</span>
            <strong>
              {stats.done} из {stats.total}
            </strong>
            <span className="cr-muted">занятий проведено</span>
          </div>
        </section>
      </div>

      <div className="cr-stats">
        <article className="cr-stat">
          <span className="cr-stat-icon">
            <IconUsersRef size={18} />
          </span>
          <div>
            <strong>{studentCount}</strong>
            <span>учеников на курсе</span>
          </div>
        </article>
        <article className="cr-stat">
          <span className="cr-stat-icon is-green">
            <IconCheckRef size={18} />
          </span>
          <div>
            <strong>{stats.done}</strong>
            <span>занятий проведено</span>
          </div>
        </article>
        <article className="cr-stat">
          <span className="cr-stat-icon is-amber">
            <IconClockRef size={18} />
          </span>
          <div>
            <strong>{stats.remaining}</strong>
            <span>занятий осталось</span>
          </div>
        </article>
      </div>

      <section className="cr-last">
        <span className="cr-kicker">Последнее проведённое занятие</span>
        {lastLesson ? (
          <button type="button" className="cr-last-row" onClick={() => onOpenLesson(lastLesson.sanityId)}>
            <span className="cr-last-date" aria-hidden="true">
              {lastParts ? (
                <>
                  <strong>{lastParts.day}</strong>
                  <em>{lastParts.month}</em>
                </>
              ) : (
                <IconCalendarRef size={18} />
              )}
            </span>
            <span className="cr-last-main">
              <strong>
                Урок {curatorLessonDisplayNo(lastLesson)}. {lastLesson.title}
              </strong>
              <span className="cr-muted">
                {[lastLesson.moduleTitle, lessonFullDate(lastLesson.endedAt ?? lastLesson.scheduledAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className={`cr-pill ${sessionPillClass(lastLesson.sessionStatus)}`}>
              {sessionLabel(lastLesson.sessionStatus)}
            </span>
            <span className="cr-lesson-go" aria-hidden="true">
              <IconChevronRightRef size={16} />
            </span>
          </button>
        ) : (
          <p className="cr-empty cr-empty--inline">Пока нет проведённых занятий.</p>
        )}
      </section>
    </div>
  );
}
