'use client';

import type { MergedStaffStudent } from '@/lib/staff/students-merge';
import {
  countUpcomingOrdinaryLessons,
  lessonsCountLabel,
  formatCourseNextLabel,
  formatNextOrdinaryWhen,
  studentSubtitle,
} from './staff-directory-utils';

type Props = {
  student: MergedStaffStudent;
  courseTitle: string;
  showOrdinary: boolean;
  showCourse: boolean;
  onOpenProfile: () => void;
};

export default function StaffStudentPreview({
  student,
  courseTitle,
  showOrdinary,
  showCourse,
  onOpenProfile,
}: Props) {
  const subtitle = studentSubtitle(student, courseTitle);

  return (
    <aside className="staff-directory-aside sched-aside-block">
      <div className="staff-directory-aside-head">
        <h2 className="staff-directory-aside-name">{student.name}</h2>
        {subtitle ? <p className="staff-directory-aside-sub">{subtitle}</p> : null}
      </div>

      {showOrdinary && student.teacher ? (
        <section className="staff-directory-section">
          <h3 className="sched-aside-label">Обычные занятия</h3>
          <p className="staff-directory-stat">
            {lessonsCountLabel(countUpcomingOrdinaryLessons(student.teacher))}
          </p>
          {formatNextOrdinaryWhen(student.teacher.nextLessonAt, student.teacher.lessons) ? (
            <p className="staff-directory-meta">
              Следующее · {formatNextOrdinaryWhen(student.teacher.nextLessonAt, student.teacher.lessons)}
            </p>
          ) : (
            <p className="staff-directory-meta staff-directory-meta--muted">Следующее не запланировано</p>
          )}
        </section>
      ) : null}

      {showCourse && student.course ? (
        <section className="staff-directory-section">
          <h3 className="sched-aside-label">Курс</h3>
          <p className="staff-directory-stat">{courseTitle}</p>
          <p className="staff-directory-meta">
            Следующее · {formatCourseNextLabel(student.course)}
          </p>
        </section>
      ) : null}

      <button type="button" className="sched-btn sched-btn--primary staff-directory-open-btn" onClick={onOpenProfile}>
        Открыть профиль
      </button>
    </aside>
  );
}
