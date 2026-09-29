'use client';

import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import { formatDateTime } from '@/components/curator/curator-utils';

type Props = {
  lessons: CuratorLessonView[];
  onOpenLesson: (sanityId: string) => void;
};

export default function CourseHistoryPanel({ lessons, onOpenLesson }: Props) {
  const completed = lessons
    .filter((l) => l.sessionStatus === 'completed')
    .sort((a, b) => b.lessonNumber - a.lessonNumber);

  return (
    <div className="curator-panel">
      <h1 className="curator-title">История</h1>
      <p className="curator-muted">Проведённые уроки и вебинары курса.</p>

      {completed.length === 0 ? (
        <p className="curator-muted">Пока нет завершённых занятий.</p>
      ) : (
        <ul className="staff-course-item-list">
          {completed.map((lesson) => (
            <li key={lesson.sanityId}>
              <button type="button" className="staff-course-item-row" onClick={() => onOpenLesson(lesson.sanityId)}>
                <span>
                  <strong>Урок {lesson.lessonNumber}</strong> — {lesson.title}
                </span>
                <span className="curator-muted">
                  {lesson.endedAt ? formatDateTime(lesson.endedAt) : 'Завершён'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
