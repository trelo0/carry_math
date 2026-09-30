'use client';

import { useEffect, useState } from 'react';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import TeacherStudentCard from './TeacherStudentCard';

type Props = {
  data: TeacherCabinetData;
  busy: boolean;
  initialStudentId?: number | null;
  runAction: import('@/lib/staff/run-action').StaffRunAction;
  onOpenLesson: (lesson: TeacherLessonView) => void;
};

export default function TeacherStudentsPanel({
  data,
  busy,
  initialStudentId,
  runAction,
  onOpenLesson,
}: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(initialStudentId ?? null);

  useEffect(() => {
    if (initialStudentId != null) setExpandedId(initialStudentId);
  }, [initialStudentId]);

  return (
    <div className="curator-panel staff-directory-page sched-page">
      <h1 className="sched-head-title">Мои ученики</h1>
      <p className="curator-muted">Нажмите на карточку — под ней откроются подробности.</p>

      <ul className="staff-directory-student-list">
        {data.students.length === 0 ? (
          <li className="staff-directory-empty">Пока нет назначенных учеников.</li>
        ) : (
          data.students.map((student) => {
            const expanded = expandedId === student.telegramId;
            return (
              <li
                key={student.telegramId}
                className={`staff-directory-student-item${expanded ? ' is-expanded' : ''}`}
              >
                <button
                  type="button"
                  className={`staff-directory-student-row${expanded ? ' is-active' : ''}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedId((prev) => (prev === student.telegramId ? null : student.telegramId))
                  }
                >
                  <span className="staff-directory-student-main">
                    <strong>{student.name ?? `ID ${student.telegramId}`}</strong>
                    <em>
                      инд. {student.individualCount} · груп. {student.groupCount}
                    </em>
                    {student.nextLessonAt ? (
                      <span className="staff-directory-student-context">
                        Ближайшее: {new Date(student.nextLessonAt).toLocaleString('ru-RU')}
                      </span>
                    ) : null}
                  </span>
                  <span className={`staff-directory-row-arrow${expanded ? ' is-open' : ''}`} aria-hidden>
                    ▾
                  </span>
                </button>
                {expanded ? (
                  <div className="staff-directory-student-expand">
                    <TeacherStudentCard
                      student={student}
                      busy={busy}
                      embedded
                      onClose={() => setExpandedId(null)}
                      onOpenLesson={onOpenLesson}
                      runAction={runAction}
                    />
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
