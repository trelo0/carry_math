'use client';

import { courseRoleBadgeShort } from '@/lib/staff/course-assignment-ui';

export type StaffCourseListItem = {
  courseId: number;
  title: string;
  studentCount: number;
  lessonCount: number;
  role: 'curator' | 'check';
};

type Props = {
  courses: StaffCourseListItem[];
  onOpenCourse: (courseId: number, role: 'curator' | 'check') => void;
};

export default function CourseListPanel({ courses, onOpenCourse }: Props) {
  return (
    <div className="curator-panel">
      <h1 className="curator-title">Мои курсы</h1>
      <p className="curator-muted">
        Выберите курс — разделы зависят от вашей роли на этом курсе (куратор или проверка ДЗ).
      </p>

      <ul className="staff-course-list">
        {courses.map((course) => (
          <li key={`${course.courseId}-${course.role}`}>
            <button
              type="button"
              className="staff-course-card"
              onClick={() => onOpenCourse(course.courseId, course.role)}
            >
              <strong>{course.title}</strong>
              <span>
                {courseRoleBadgeShort(course.role)} · {course.studentCount}{' '}
                учеников · {course.lessonCount} уроков
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
