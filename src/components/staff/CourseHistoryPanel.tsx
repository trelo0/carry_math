'use client';

import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import {
  compareCuratorLessonsProgramOrder,
  curatorLessonDisplayNo,
  formatDateTime,
} from '@/components/curator/curator-utils';
type Props = {
  lessons: CuratorLessonView[];
  onOpenLesson: (sanityId: string) => void;
};

export default function CourseHistoryPanel({ lessons, onOpenLesson }: Props) {
  const completed = lessons
    .filter((l) => l.sessionStatus === 'completed')
    .sort((a, b) => {
      const ta = a.endedAt
        ? new Date(a.endedAt).getTime()
        : a.scheduledAt
          ? new Date(a.scheduledAt).getTime()
          : 0;
      const tb = b.endedAt
        ? new Date(b.endedAt).getTime()
        : b.scheduledAt
          ? new Date(b.scheduledAt).getTime()
          : 0;
      return tb - ta || compareCuratorLessonsProgramOrder(b, a);
    });

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
                  <strong>Занятие {curatorLessonDisplayNo(lesson)}</strong> — {lesson.title}
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
