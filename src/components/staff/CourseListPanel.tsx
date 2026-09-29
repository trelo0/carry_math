'use client';

type Props = {
  courseTitle: string;
  studentCount: number;
  lessonCount: number;
  onOpenCourse: () => void;
};

export default function CourseListPanel({
  courseTitle,
  studentCount,
  lessonCount,
  onOpenCourse,
}: Props) {
  return (
    <div className="curator-panel">
      <h1 className="curator-title">Мои курсы</h1>
      <p className="curator-muted">Курсы, с которыми вы работаете как куратор.</p>

      <ul className="staff-course-list">
        <li>
          <button type="button" className="staff-course-card" onClick={onOpenCourse}>
            <strong>{courseTitle}</strong>
            <span>
              {studentCount} учеников · {lessonCount} уроков
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}
