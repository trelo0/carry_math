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
  const [selectedId, setSelectedId] = useState<number | null>(initialStudentId ?? null);

  useEffect(() => {
    if (initialStudentId != null) setSelectedId(initialStudentId);
  }, [initialStudentId]);

  const selected = data.students.find((s) => s.telegramId === selectedId) ?? null;

  return (
    <div className="curator-panel">
      <h1 className="curator-title">Мои ученики</h1>
      <p className="curator-muted">Ученики с индивидуальными и групповыми занятиями.</p>

      <div className="teacher-students-layout">
        <ul className="teacher-students-list">
          {data.students.length === 0 ? (
            <li className="curator-muted">Пока нет назначенных учеников.</li>
          ) : (
            data.students.map((student) => (
              <li key={student.telegramId}>
                <button
                  type="button"
                  className={`teacher-student-btn${selectedId === student.telegramId ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(student.telegramId)}
                >
                  <strong>{student.name ?? `ID ${student.telegramId}`}</strong>
                  <span>
                    инд. {student.individualCount} · груп. {student.groupCount}
                  </span>
                  {student.nextLessonAt ? (
                    <em>Ближайшее: {new Date(student.nextLessonAt).toLocaleString('ru-RU')}</em>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>

        {selected ? (
          <TeacherStudentCard
            student={selected}
            busy={busy}
            onClose={() => setSelectedId(null)}
            onOpenLesson={onOpenLesson}
            runAction={runAction}
          />
        ) : null}
      </div>
    </div>
  );
}
