'use client';

import { IconCalendarRef, IconChevronRightRef, IconUsersRef } from './schedule/ScheduleRefIcons';
import { lessonWord, studentWord } from './course/course-utils';

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

function cleanTitle(title: string): string {
  return title.replace(/^["«“\s]+|["»”\s]+$/g, '') || title;
}

function courseInitial(title: string): string {
  return cleanTitle(title).charAt(0).toUpperCase() || '•';
}

export default function CourseListPanel({ courses, onOpenCourse }: Props) {
  return (
    <div className="cr-root cr-root--list">
      <header className="cr-hero">
        <h1 className="cr-title">Мои курсы</h1>
        <p className="cr-muted">Выберите курс, чтобы открыть обзор, занятия и учеников.</p>
      </header>

      {courses.length === 0 ? (
        <p className="cr-empty">Вам пока не назначено ни одного курса.</p>
      ) : (
        <ul className="cr-course-grid">
          {courses.map((course) => (
            <li key={`${course.courseId}-${course.role}`}>
              <button
                type="button"
                className="cr-course-card"
                onClick={() => onOpenCourse(course.courseId, course.role)}
              >
                <span className="cr-course-top">
                  <span className="cr-course-badge" aria-hidden="true">
                    {courseInitial(course.title)}
                  </span>
                  <span className="cr-course-role">
                    {course.role === 'curator' ? 'Куратор' : 'Проверка ДЗ'}
                  </span>
                </span>
                <span className="cr-course-name">{cleanTitle(course.title)}</span>
                <span className="cr-course-stats">
                  <span className="cr-course-stat">
                    <IconCalendarRef size={16} />
                    <b>{course.lessonCount}</b>
                    <span>{lessonWord(course.lessonCount)}</span>
                  </span>
                  <span className="cr-course-stat">
                    <IconUsersRef size={16} />
                    <b>{course.studentCount}</b>
                    <span>{studentWord(course.studentCount)}</span>
                  </span>
                </span>
                <span className="cr-course-go">
                  Открыть курс <IconChevronRightRef size={14} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
