'use client';

import type { CuratorStudentView } from '@/lib/curator/students';
import type { MergedStaffStudent } from '@/lib/staff/students-merge';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { hwStatusLabel } from '@/components/curator/curator-utils';
import TeacherStudentCard from './TeacherStudentCard';

import type { StaffRunAction } from '@/lib/staff/run-action';

type Props = {
  student: MergedStaffStudent;
  courseTitle: string;
  showOrdinary: boolean;
  showCourse: boolean;
  busy: boolean;
  onClose?: () => void;
  onOpenLesson: (lesson: TeacherLessonView) => void;
  onOpenCourseSection?: () => void;
  runAction: StaffRunAction;
  embedded?: boolean;
};

function CourseStudentSection({
  student,
  courseTitle,
  onOpenCourseSection,
}: {
  student: CuratorStudentView;
  courseTitle: string;
  onOpenCourseSection?: () => void;
}) {
  const reviewCount = student.homeworks.filter((hw) => hw.status === 'submitted').length;
  const debtCount = student.homeworks.filter((hw) => hw.status === 'waiting').length;
  const tgUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'district_math_bot'}?start=contact_${student.telegramId}`;

  return (
    <section className="staff-student-context staff-student-context--course">
      <h3 className="staff-student-context-title">Курс</h3>
      <p className="schedule-detail-primary">{courseTitle}</p>
      <dl className="schedule-side-facts">
        <div>
          <dt>Прогресс</dt>
          <dd>
            {student.progressPercent}% · {student.completedLessons}/{student.totalLessons} уроков
          </dd>
        </div>
        {student.enrolledAt ? (
          <div>
            <dt>Подключён</dt>
            <dd>{new Date(student.enrolledAt).toLocaleDateString('ru-RU')}</dd>
          </div>
        ) : null}
        <div>
          <dt>Жизни</dt>
          <dd>
            {student.livesCurrent ?? '—'}/{student.livesMax ?? '—'}
          </dd>
        </div>
        <div>
          <dt>Домашние задания</dt>
          <dd>
            {reviewCount > 0 ? `${reviewCount} на проверке` : 'Нет на проверке'}
            {debtCount > 0 ? ` · ${debtCount} не сдано` : ''}
          </dd>
        </div>
      </dl>

      {student.homeworks.filter((hw) => hw.status !== 'upcoming').length > 0 ? (
        <ul className="staff-student-hw-list">
          {student.homeworks
            .filter((hw) => hw.status !== 'upcoming')
            .slice(0, 5)
            .map((hw) => (
              <li key={`${hw.number}-${hw.status}`}>
                Урок {hw.number}: {hwStatusLabel(hw.status)}
              </li>
            ))}
        </ul>
      ) : null}

      <div className="teacher-student-card-actions">
        <a href={tgUrl} className="curator-btn curator-btn--primary" target="_blank" rel="noopener noreferrer">
          Telegram
        </a>
        {onOpenCourseSection ? (
          <button type="button" className="curator-btn" onClick={onOpenCourseSection}>
            Подробнее в разделе курса
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default function StaffStudentDetail({
  student,
  courseTitle,
  showOrdinary,
  showCourse,
  busy,
  onClose,
  onOpenLesson,
  onOpenCourseSection,
  runAction,
  embedded = false,
}: Props) {
  const tgUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'district_math_bot'}?start=contact_${student.telegramId}`;

  return (
    <div className={`staff-student-detail${embedded ? ' staff-student-detail--embedded' : ''}`}>
      {!embedded ? (
        <>
          <header className="teacher-student-card-head">
            <div>
              <h2>{student.name}</h2>
              <p className="curator-muted">
                {student.phone ? `Телефон: ${student.phone}` : null}
                {student.phone ? ' · ' : ''}
                Telegram ID: {student.telegramId}
              </p>
            </div>
            {onClose ? (
              <button type="button" className="curator-btn" onClick={onClose}>
                Закрыть
              </button>
            ) : null}
          </header>

          <div className="staff-student-context-tags">
            {student.hasOrdinary ? (
              <span className="schedule-side-kind schedule-side-kind--individual">Обычные занятия</span>
            ) : null}
            {student.hasCourse ? <span className="schedule-side-kind schedule-side-kind--course">Курс</span> : null}
          </div>

          <div className="teacher-student-card-actions">
            <a href={tgUrl} className="curator-btn curator-btn--primary" target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
          </div>
        </>
      ) : (
        <div className="staff-student-detail-embedded-meta">
          {student.phone ? <p className="curator-muted">Телефон: {student.phone}</p> : null}
          <p className="curator-muted">Telegram ID: {student.telegramId}</p>
          <div className="staff-student-context-tags">
            {student.hasOrdinary ? (
              <span className="schedule-side-kind schedule-side-kind--individual">Обычные занятия</span>
            ) : null}
            {student.hasCourse ? <span className="schedule-side-kind schedule-side-kind--course">Курс</span> : null}
          </div>
          <div className="teacher-student-card-actions">
            <a href={tgUrl} className="curator-btn curator-btn--primary" target="_blank" rel="noopener noreferrer">
              Написать в Telegram
            </a>
          </div>
        </div>
      )}

      {showOrdinary && student.teacher ? (
        <section className="staff-student-context staff-student-context--ordinary">
          <h3 className="staff-student-context-title">Обычные занятия</h3>
          {student.groupTitles.length > 0 ? (
            <p className="curator-muted">Группы: {student.groupTitles.join(', ')}</p>
          ) : null}
          <TeacherStudentCard
            student={student.teacher}
            busy={busy}
            embedded
            onClose={onClose ?? (() => {})}
            onOpenLesson={onOpenLesson}
            runAction={runAction}
          />
        </section>
      ) : null}

      {showCourse && student.course ? (
        <CourseStudentSection
          student={student.course}
          courseTitle={courseTitle}
          onOpenCourseSection={onOpenCourseSection}
        />
      ) : null}

      {!showOrdinary && !showCourse ? (
        <p className="curator-muted">Нет доступных данных для выбранного контекста.</p>
      ) : null}
    </div>
  );
}
