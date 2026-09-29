'use client';

import { useMemo, useState } from 'react';
import type { CuratorStudentView } from '@/lib/curator/students';
import {
  filterStaffStudents,
  getStaffStudentFilters,
  mergeStaffStudents,
  searchStaffStudents,
  type StaffStudentFilter,
} from '@/lib/staff/students-merge';
import type { StaffScheduleMode } from '@/lib/teacher/schedule-config';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { StaffRunAction } from '@/lib/staff/run-action';
import StaffStudentDetail from './StaffStudentDetail';
import StaffStudentPreview from './StaffStudentPreview';
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
  const [selectedId, setSelectedId] = useState<number | null>(initialStudentId ?? null);
  const [profileOpen, setProfileOpen] = useState(false);

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

  const selected =
    visibleStudents.find((student) => student.telegramId === selectedId) ??
    mergedStudents.find((student) => student.telegramId === selectedId) ??
    null;

  const showOrdinaryDetail =
    Boolean(selected?.hasOrdinary && teacherData) &&
    (mode === 'teacher' || filter === 'all' || filter === 'ordinary');
  const showCourseDetail =
    Boolean(selected?.hasCourse) && (mode === 'curator' || filter === 'all' || filter === 'course');
  const useFullTeacherCard =
    Boolean(selected?.teacher && showOrdinaryDetail && !showCourseDetail && mode !== 'curator');

  const hasAside = Boolean(selected);

  return (
    <div className={`staff-directory-page sched-page${hasAside ? ' has-aside' : ''}`}>
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

      <div className="sched-body">
        <div className="staff-directory-main sched-main">
          <ul className="staff-directory-student-list">
            {visibleStudents.length === 0 ? (
              <li className="staff-directory-empty">Ученики не найдены.</li>
            ) : (
              visibleStudents.map((student) => {
                const subtitle = studentSubtitle(student, courseTitle);
                return (
                  <li key={student.telegramId}>
                    <button
                      type="button"
                      className={`staff-directory-student-row${selectedId === student.telegramId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(student.telegramId);
                        setProfileOpen(false);
                      }}
                    >
                      <span className="staff-directory-student-main">
                        <strong>{student.name}</strong>
                        {subtitle ? <em>{subtitle}</em> : null}
                        <span className="staff-directory-student-context">{studentContextLine(student)}</span>
                      </span>
                      <span className="staff-directory-row-arrow" aria-hidden>
                        →
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {selected ? (
          <StaffStudentPreview
            student={selected}
            courseTitle={courseTitle}
            showOrdinary={showOrdinaryDetail}
            showCourse={showCourseDetail}
            onOpenProfile={() => setProfileOpen(true)}
          />
        ) : null}
      </div>

      {profileOpen && selected ? (
        <div className="staff-directory-overlay" role="dialog" aria-modal="true">
          <div className="staff-directory-overlay-panel">
            {useFullTeacherCard && selected.teacher ? (
              <TeacherStudentCard
                student={selected.teacher}
                busy={busy}
                onClose={() => setProfileOpen(false)}
                onOpenLesson={onOpenLesson}
                runAction={runAction}
              />
            ) : (
              <StaffStudentDetail
                student={selected}
                courseTitle={courseTitle}
                showOrdinary={showOrdinaryDetail}
                showCourse={showCourseDetail}
                busy={busy}
                onClose={() => setProfileOpen(false)}
                onOpenLesson={onOpenLesson}
                onOpenCourseSection={onOpenCourseSection}
                runAction={runAction}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
