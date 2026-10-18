'use client';

import type { CuratorStudentView } from '@/lib/curator/students';

export default function CuratorStudentsPanel({ students }: { students: CuratorStudentView[] }) {
  if (students.length === 0) {
    return (
      <div className="curator-panel">
        <h1 className="curator-title">Ученики</h1>
        <p className="curator-muted">Пока нет учеников с оплаченным доступом к курсу.</p>
      </div>
    );
  }

  return (
    <div className="curator-panel curator-panel--wide">
      <header className="curator-page-head">
        <div>
          <h1 className="curator-title">Ученики курса</h1>
          <p className="curator-muted">
            {students.length} человек · только просмотр (редактирование недоступно)
          </p>
        </div>
      </header>

      <ul className="curator-student-list">
        {students.map((student) => (
          <li key={student.id} className="curator-student-card curator-student-card--static">
            <div className="curator-student-summary">
              <div className="curator-student-main">
                <strong>{student.name}</strong>
                <p className="curator-muted">
                  Прогресс {student.progressPercent}% · {student.completedLessons} из{' '}
                  {student.totalLessons} занятий
                </p>
                <div className="curator-progress-bar curator-progress-bar--inline" aria-hidden="true">
                  <i style={{ width: `${student.progressPercent}%` }} />
                </div>
              </div>
              <div className="curator-student-metrics">
                <span>Оплаченных занятий: {student.remainingPaidLessons}</span>
                <span>
                  ❤️ {student.livesCurrent ?? '—'}
                  {student.livesMax != null ? `/${student.livesMax}` : ''}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
