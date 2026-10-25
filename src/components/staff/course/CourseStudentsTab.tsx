'use client';

import type { CuratorStudentView } from '@/lib/curator/students';
import { studentWord } from './course-utils';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0].charAt(0) + (parts[1]?.charAt(0) ?? '')).toUpperCase();
}

export default function CourseStudentsTab({ students }: { students: CuratorStudentView[] }) {
  return (
    <div className="cr-students">
      <div className="cr-lessons-head">
        <h2 className="cr-h2">Ученики курса</h2>
        <span className="cr-muted">
          {students.length} {studentWord(students.length)}
        </span>
      </div>

      {students.length === 0 ? (
        <p className="cr-empty">Пока нет учеников с доступом к курсу.</p>
      ) : (
        <ul className="cr-student-list">
          {students.map((student) => (
            <li key={student.id} className="cr-student">
              <span className="cr-avatar" aria-hidden="true">
                {initials(student.name)}
              </span>
              <div className="cr-student-main">
                <strong className="cr-student-name">{student.name}</strong>
                <span className="cr-muted">
                  {student.completedLessons} из {student.totalLessons} занятий
                </span>
                <div className="cr-progress" aria-hidden="true">
                  <i style={{ width: `${student.progressPercent}%` }} />
                </div>
              </div>
              <div className="cr-student-side">
                <strong>{student.progressPercent}%</strong>
                <span className="cr-muted">оплачено: {student.remainingPaidLessons}</span>
                {student.overdueHomeworkCount > 0 ? (
                  <span className="cr-pill is-warn">ДЗ просрочено: {student.overdueHomeworkCount}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
