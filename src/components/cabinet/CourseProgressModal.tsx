'use client';

import { formatLessonCount, type CourseProgressSummary } from '@/lib/course-completion';

type Props = {
  open: boolean;
  courseTitle: string;
  progress: CourseProgressSummary;
  onClose: () => void;
};

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 18c4-8 8-12 16-14M4 18l3-2M4 18l1 3M20 4l-2 2M20 4l1 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CourseProgressModal({ open, courseTitle, progress, onClose }: Props) {
  if (!open) return null;

  const { totalLessons, completedLessons, remainingLessons, coursePercent } = progress;
  const remainingLabel = formatLessonCount(remainingLessons);

  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal cab-modal--enroll cab-modal--course-progress"
        role="dialog"
        aria-labelledby="course-progress-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cab-modal-icon" aria-hidden="true">
          <RouteIcon />
        </span>
        <h3 id="course-progress-title">Твой путь по курсу</h3>
        <p className="cab-course-progress-course">{courseTitle}</p>
        <div className="cab-course-progress-meter" aria-hidden="true">
          <span style={{ width: `${coursePercent}%` }} />
        </div>
        <p className="cab-course-progress-pct">{coursePercent}% пройдено</p>
        <p className="cab-course-progress-stats">
          Завершено: <strong>{formatLessonCount(completedLessons)}</strong> из{' '}
          <strong>{formatLessonCount(totalLessons)}</strong>
        </p>
        <p className="cab-course-progress-remain">
          {remainingLessons > 0 ? (
            <>
              До финиша осталось пройти <strong>{remainingLabel}</strong> с одобренным домашним заданием.
            </>
          ) : (
            <>Осталось закрыть последние шаги — скоро увидишь финиш на карте.</>
          )}
        </p>
        <div className="cab-modal-actions">
          <button type="button" className="cab-btn cab-btn--join" onClick={onClose}>
            Продолжить путь
          </button>
        </div>
      </div>
    </div>
  );
}
