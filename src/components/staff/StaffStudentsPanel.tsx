'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CuratorStudentView } from '@/lib/curator/students';
import {
  filterStaffStudents,
  getStaffStudentFilters,
  mergeStaffStudents,
  searchStaffStudents,
  type MergedStaffStudent,
  type StaffStudentFilter,
} from '@/lib/staff/students-merge';
import type { StaffScheduleMode } from '@/lib/teacher/schedule-config';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { StaffRunAction } from '@/lib/staff/run-action';
import StaffStudentDetail from './StaffStudentDetail';
import { studentContextLine, studentSubtitle } from './staff-directory-utils';
import TeacherStudentCard from './TeacherStudentCard';

type Props = {
  mode: StaffScheduleMode;
  teacherData?: TeacherCabinetData;
  courseStudents?: CuratorStudentView[];
  courseTitle: string;
  busy: boolean;
  initialStudentId?: number | null;
  onOpenLesson: (lesson: TeacherLessonView) => void;
  onOpenCourseSection?: () => void;
  runAction: StaffRunAction;
};

function detailFlags(
  student: MergedStaffStudent,
  mode: StaffScheduleMode,
  filter: StaffStudentFilter,
  hasTeacherData: boolean,
) {
  const showOrdinary =
    Boolean(student.hasOrdinary && hasTeacherData) &&
    (mode === 'teacher' || filter === 'all' || filter === 'ordinary');
  const showCourse =
    Boolean(student.hasCourse) && (mode === 'curator' || filter === 'all' || filter === 'course');
  const useFullTeacherCard =
    Boolean(student.teacher && showOrdinary && !showCourse && mode !== 'curator');
  return { showOrdinary, showCourse, useFullTeacherCard };
}

export default function StaffStudentsPanel({
  mode,
  teacherData,
  courseStudents = [],
  courseTitle,
  busy,
  initialStudentId,
  onOpenLesson,
  onOpenCourseSection,
  runAction,
}: Props) {
  const filters = useMemo(() => getStaffStudentFilters(mode), [mode]);
  const [filter, setFilter] = useState<StaffStudentFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(initialStudentId ?? null);

  useEffect(() => {
    if (initialStudentId != null) setExpandedId(initialStudentId);
  }, [initialStudentId]);

  const mergedStudents = useMemo(
    () =>
      mergeStaffStudents({
        teacherStudents: teacherData?.students ?? [],
        teacherGroups: teacherData?.groups ?? [],
        courseStudents,
        courseTitle,
      }),
    [teacherData?.students, teacherData?.groups, courseStudents, courseTitle],
  );

  const visibleStudents = useMemo(() => {
    const filtered = filterStaffStudents(mergedStudents, filter);
    return searchStaffStudents(filtered, search);
  }, [mergedStudents, filter, search]);

  const toggleStudent = (telegramId: number) => {
    setExpandedId((prev) => (prev === telegramId ? null : telegramId));
  };

  const hasTeacherData = Boolean(teacherData);

  return (
    <div className="staff-directory-page sched-page">
      <header className="staff-directory-head sched-head">
        <h1 className="sched-head-title">Ученики</h1>
        <div className="staff-directory-toolbar sched-head-subrow">
          <label className="staff-directory-search">
            <span className="visually-hidden">Поиск ученика</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск ученика..."
            />
          </label>
          {filters.length > 0 ? (
            <div className="schedule-filters">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`schedule-filter-btn${filter === item.id ? ' is-active' : ''}`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="staff-directory-main staff-directory-main--accordion">
        <ul className="staff-directory-student-list">
          {visibleStudents.length === 0 ? (
            <li className="staff-directory-empty">Ученики не найдены.</li>
          ) : (
            visibleStudents.map((student) => {
              const subtitle = studentSubtitle(student, courseTitle);
              const expanded = expandedId === student.telegramId;
              const flags = detailFlags(student, mode, filter, hasTeacherData);

              return (
                <li
                  key={student.telegramId}
                  className={`staff-directory-student-item${expanded ? ' is-expanded' : ''}`}
                >
                  <button
                    type="button"
                    className={`staff-directory-student-row${expanded ? ' is-active' : ''}`}
                    aria-expanded={expanded}
                    onClick={() => toggleStudent(student.telegramId)}
                  >
                    <span className="staff-directory-student-main">
                      <strong>{student.name}</strong>
                      {subtitle ? <em>{subtitle}</em> : null}
                      <span className="staff-directory-student-context">{studentContextLine(student)}</span>
                    </span>
                    <span className={`staff-directory-row-arrow${expanded ? ' is-open' : ''}`} aria-hidden>
                      ▾
                    </span>
                  </button>

                  {expanded ? (
                    <div className="staff-directory-student-expand">
                      {flags.useFullTeacherCard && student.teacher ? (
                        <TeacherStudentCard
                          student={student.teacher}
                          busy={busy}
                          embedded
                          onClose={() => setExpandedId(null)}
                          onOpenLesson={onOpenLesson}
                          runAction={runAction}
                        />
                      ) : (
                        <StaffStudentDetail
                          student={student}
                          courseTitle={courseTitle}
                          showOrdinary={flags.showOrdinary}
                          showCourse={flags.showCourse}
                          busy={busy}
                          embedded
                          onOpenLesson={onOpenLesson}
                          onOpenCourseSection={onOpenCourseSection}
                          runAction={runAction}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
