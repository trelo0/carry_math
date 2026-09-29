'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { memberHasRole } from '@/lib/bot/roles';
import type { StaffCabinetData } from '@/lib/teacher/cabinet-data';
import type { CuratorHomeworkQueueItem } from '@/lib/curator/cabinet-data';
import CuratorDashboard from '@/components/curator/CuratorDashboard';
import CuratorLessonsPanel from '@/components/curator/CuratorLessonsPanel';
import CuratorStudentsPanel from '@/components/curator/CuratorStudentsPanel';
import CuratorHomeworkPanel from '@/components/curator/CuratorHomeworkPanel';
import CuratorSettingsPanel from '@/components/curator/CuratorSettingsPanel';
import CourseHistoryPanel from './CourseHistoryPanel';
import CourseListPanel from './CourseListPanel';
import StaffContextHeader from './StaffContextHeader';
import TeacherGroupsPanel from './TeacherGroupsPanel';
import TeacherLessonRoom from './TeacherLessonRoom';
import TeacherLiveBanner from './TeacherLiveBanner';
import StaffStudentsPanel from './StaffStudentsPanel';
import TeacherSchedulePanel from './schedule/TeacherSchedulePanel';
import { resolveStaffScheduleMode } from '@/lib/teacher/schedule-config';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { readStartedLessonIds, writeStartedLessonIds } from '@/lib/teacher/started-lessons';
import type { StaffRefreshScope, StaffRunAction } from '@/lib/staff/run-action';

export type StaffSection =
  | 'teacher-calendar'
  | 'teacher-students'
  | 'teacher-groups'
  | 'course-list'
  | 'course-overview'
  | 'course-students'
  | 'course-lessons'
  | 'course-history'
  | 'course-homework'
  | 'settings';

type NavItem = { id: StaffSection; label: string; badge?: number; indent?: boolean };
type NavGroup = { label: string; items: NavItem[]; subLabel?: string };

const STAFF_SECTIONS: StaffSection[] = [
  'teacher-calendar',
  'teacher-students',
  'teacher-groups',
  'course-list',
  'course-overview',
  'course-students',
  'course-lessons',
  'course-history',
  'course-homework',
  'settings',
];

const LEGACY_SECTION_MAP: Record<string, StaffSection> = {
  'teacher-home': 'teacher-calendar',
  'teacher-schedule': 'teacher-calendar',
  'teacher-availability': 'teacher-calendar',
  'teacher-bookings': 'teacher-calendar',
  dashboard: 'course-overview',
  lessons: 'course-lessons',
  students: 'course-students',
  homework: 'course-homework',
  'curator-dashboard': 'course-overview',
  'curator-lessons': 'course-lessons',
  'curator-students': 'course-students',
  'curator-homework': 'course-homework',
  'course-schedule': 'course-lessons',
};

const COURSE_SECTIONS = new Set<StaffSection>([
  'course-list',
  'course-overview',
  'course-students',
  'course-lessons',
  'course-history',
  'course-homework',
]);

function canShowCurator(data: StaffCabinetData): boolean {
  return Boolean(
    data.curator && (data.fullStaffPreview || memberHasRole(data.memberRoles, 'curator')),
  );
}

function canShowTeacher(data: StaffCabinetData): boolean {
  return Boolean(
    data.teacher && (data.fullStaffPreview || memberHasRole(data.memberRoles, 'teacher')),
  );
}

function canShowSchedule(data: StaffCabinetData): boolean {
  return canShowTeacher(data) || canShowCurator(data);
}

function canShowStudents(data: StaffCabinetData): boolean {
  return canShowTeacher(data) || canShowCurator(data);
}

function isCombinedStaff(data: StaffCabinetData): boolean {
  return canShowTeacher(data) && canShowCurator(data);
}

function buildStaffNav(data: StaffCabinetData): NavGroup[] {
  const groups: NavGroup[] = [];
  const showTeacher = canShowTeacher(data);
  const showCurator = canShowCurator(data) && Boolean(data.curator);
  const combined = showTeacher && showCurator;

  if (combined) {
    groups.push({
      label: 'Моя работа',
      items: [
        { id: 'teacher-calendar', label: 'Расписание' },
        { id: 'teacher-students', label: 'Ученики' },
        { id: 'teacher-groups', label: 'Группы' },
      ],
    });
  } else if (showTeacher) {
    groups.push({
      label: 'Обычные занятия',
      items: [
        { id: 'teacher-calendar', label: 'Расписание' },
        { id: 'teacher-students', label: 'Ученики' },
        { id: 'teacher-groups', label: 'Группы' },
      ],
    });
  } else if (showCurator) {
    groups.push({
      label: 'Моя работа',
      items: [
        { id: 'teacher-calendar', label: 'Расписание' },
        { id: 'teacher-students', label: 'Ученики' },
      ],
    });
  }

  if (showCurator && data.curator) {
    const courseTitle = data.curator.courseTitle;
    groups.push({
      label: 'Курсы',
      items: [{ id: 'course-list', label: 'Мои курсы' }],
      subLabel: courseTitle,
    });
    groups.push({
      label: courseTitle,
      items: [
        { id: 'course-overview', label: 'Обзор', indent: true },
        { id: 'course-students', label: 'Ученики', indent: true },
        { id: 'course-lessons', label: 'Модули и уроки', indent: true },
        { id: 'course-history', label: 'История', indent: true },
      ],
    });
  }

  groups.push({
    label: 'Аккаунт',
    items: [{ id: 'settings', label: 'Настройки' }],
  });

  return groups;
}

function defaultSection(data: StaffCabinetData): StaffSection {
  if (canShowSchedule(data)) return 'teacher-calendar';
  if (canShowCurator(data)) return 'course-overview';
  return 'settings';
}

function resolveInitialSection(data: StaffCabinetData, initial?: string): StaffSection {
  if (!initial) return defaultSection(data);
  const mapped = LEGACY_SECTION_MAP[initial] ?? initial;
  if (STAFF_SECTIONS.includes(mapped as StaffSection)) return mapped as StaffSection;
  return defaultSection(data);
}

function isCourseSection(section: StaffSection): boolean {
  return COURSE_SECTIONS.has(section);
}

async function reloadData(): Promise<StaffCabinetData> {
  const res = await fetch('/api/cabinet/staff/data', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось обновить данные');
  return res.json() as Promise<StaffCabinetData>;
}

async function reloadTeacherData(): Promise<TeacherCabinetData> {
  const res = await fetch('/api/cabinet/staff/teacher-data', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось обновить расписание');
  return res.json() as Promise<TeacherCabinetData>;
}

type Props = {
  data: StaffCabinetData;
  initialSection?: string;
  initialLessonId?: string;
  showCabinetPick?: boolean;
};

export default function StaffShell({
  data: initialData,
  initialSection,
  initialLessonId,
  showCabinetPick,
}: Props) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<StaffSection>(() =>
    resolveInitialSection(initialData, initialSection),
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(initialLessonId ?? null);
  const [selectedTeacherStudentId, setSelectedTeacherStudentId] = useState<number | null>(null);
  const [selectedTeacherGroupId, setSelectedTeacherGroupId] = useState<number | null>(null);
  const [openTeacherLesson, setOpenTeacherLesson] = useState<TeacherLessonView | null>(null);
  const [startedLessonIds, setStartedLessonIds] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStartedLessonIds(readStartedLessonIds());
  }, []);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState<CuratorHomeworkQueueItem | null>(null);

  const navGroups = useMemo(() => buildStaffNav(data), [data]);
  const courseTitle = data.curator?.courseTitle ?? 'Курс';
  const scheduleMode = resolveStaffScheduleMode(canShowTeacher(data), canShowCurator(data));
  const combinedStaff = isCombinedStaff(data);

  const refresh = useCallback(async (scope: StaffRefreshScope = 'full') => {
    if (scope === 'none') return;
    if (scope === 'teacher') {
      const teacher = await reloadTeacherData();
      setData((prev) => ({ ...prev, teacher }));
      return;
    }
    const next = await reloadData();
    setData(next);
  }, []);

  const patchTeacher = useCallback((patch: (prev: TeacherCabinetData) => TeacherCabinetData) => {
    setData((prev) => {
      if (!prev.teacher) return prev;
      return { ...prev, teacher: patch(prev.teacher) };
    });
  }, []);

  const runAction: StaffRunAction = useCallback(
    async (action, successText, options) => {
      setBusy(true);
      try {
        const resultText = await action();
        const refreshScope = options?.refresh ?? 'full';
        if (refreshScope !== 'none') {
          const refreshPromise = refresh(refreshScope);
          if (options?.awaitRefresh) {
            await refreshPromise;
          } else {
            void refreshPromise.catch(() => undefined);
          }
        }
        const message = resultText ?? successText;
        return message ? { type: 'success', message } : null;
      } catch (error) {
        return {
          type: 'error',
          message: error instanceof Error ? error.message : 'Ошибка',
        };
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const openTeacherStudent = useCallback((telegramId: number) => {
    setSelectedTeacherStudentId(telegramId);
    setSection('teacher-students');
  }, []);

  const openTeacherGroup = useCallback((groupId: number) => {
    setSelectedTeacherGroupId(groupId);
    setSection('teacher-groups');
  }, []);

  const openTeacherLessonRoom = useCallback((lesson: TeacherLessonView) => {
    setOpenTeacherLesson(lesson);
  }, []);

  const markLessonStarted = useCallback((lessonId: number) => {
    setStartedLessonIds((prev) => {
      const next = new Set(prev);
      next.add(lessonId);
      writeStartedLessonIds(next);
      return next;
    });
  }, []);

  const markLessonFinished = useCallback((lessonId: number) => {
    setStartedLessonIds((prev) => {
      if (!prev.has(lessonId)) return prev;
      const next = new Set(prev);
      next.delete(lessonId);
      writeStartedLessonIds(next);
      return next;
    });
    setOpenTeacherLesson((prev) => (prev?.id === lessonId ? null : prev));
  }, []);

  const startTeacherLesson = useCallback(
    (lesson: TeacherLessonView) => {
      markLessonStarted(lesson.id);
    },
    [markLessonStarted],
  );

  const openCourseLesson = useCallback((sanityId: string) => {
    setSection('course-lessons');
    setSelectedLessonId(sanityId);
  }, []);

  useEffect(() => {
    if (!openTeacherLesson || !data.teacher) return;
    const all = [...data.teacher.individualLessons, ...data.teacher.groupLessons];
    const updated = all.find((lesson) => lesson.id === openTeacherLesson.id);
    if (updated) setOpenTeacherLesson(updated);
    else setOpenTeacherLesson(null);
  }, [data.teacher, openTeacherLesson?.id]);

  const showTeacherLive =
    data.teacher?.currentLesson &&
    (section === 'teacher-calendar' ||
      section === 'teacher-students' ||
      section === 'teacher-groups' ||
      (!canShowCurator(data) && section === 'settings'));

  const roleLabel = useMemo(() => {
    if (data.fullStaffPreview) return 'Admin · preview';
    const parts: string[] = [];
    if (memberHasRole(data.memberRoles, 'curator')) parts.push('Куратор');
    if (memberHasRole(data.memberRoles, 'teacher')) parts.push('Преподаватель');
    return parts.join(' · ') || 'Staff';
  }, [data.fullStaffPreview, data.memberRoles]);

  useEffect(() => {
    if (section === 'teacher-calendar' && !canShowSchedule(data)) {
      setSection(defaultSection(data));
    }
    if (section === 'teacher-students' && !canShowStudents(data)) {
      setSection(defaultSection(data));
    }
    const isTeacherOnlySection = section === 'teacher-groups';
    if (isTeacherOnlySection && !canShowTeacher(data)) {
      setSection(defaultSection(data));
    }
    if (isCourseSection(section) && !canShowCurator(data)) {
      setSection(defaultSection(data));
    }
  }, [section, data]);

  const handleNavClick = (itemId: StaffSection) => {
    setSection(itemId);
    if (itemId !== 'course-lessons') setSelectedLessonId(null);
  };

  return (
    <div className="curator-cabinet staff-cabinet">
      <aside className="curator-sidebar">
        <div className="curator-brand">
          <span className="curator-brand-name">District</span>
          <span className="curator-brand-role">{roleLabel}</span>
        </div>
        <nav className="curator-nav">
          {navGroups.map((group, index) => (
            <div
              key={`${group.label}-${index}`}
              className={`staff-nav-group${group.subLabel ? ' staff-nav-group--course' : ''}`}
            >
              <span className="staff-nav-head">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`curator-nav-btn${section === item.id ? ' is-active' : ''}${item.indent ? ' staff-nav-btn--indent' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  {item.label}
                  {item.badge && item.badge > 0 ? (
                    <span className="curator-badge">{item.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="curator-sidebar-foot">
          {showCabinetPick || data.fullStaffPreview ? (
            <Link href="/cabinet/pick" className="curator-link curator-pick-link">
              Выбор кабинета
            </Link>
          ) : null}
          <p>{data.staffName ?? 'Сотрудник'}</p>
        </div>
      </aside>

      <main className="curator-main">
        {showTeacherLive && data.teacher?.currentLesson ? (
          <TeacherLiveBanner
            lesson={data.teacher.currentLesson}
            onOpen={() => {
              setSection('teacher-calendar');
            }}
          />
        ) : null}

        {data.curator && !data.curator.sanityWriteEnabled && isCourseSection(section) ? (
          <div className="curator-warn">
            SANITY_API_WRITE_TOKEN не настроен — редактирование ссылок и файлов в Sanity недоступно.
          </div>
        ) : null}

        {section === 'teacher-calendar' && canShowSchedule(data) ? (
          <>
            <StaffContextHeader
              area={combinedStaff || (canShowCurator(data) && !canShowTeacher(data)) ? 'work' : 'regular'}
            />
            <TeacherSchedulePanel
              mode={scheduleMode}
              teacherData={data.teacher ?? undefined}
              courseLessons={data.curator?.lessons ?? []}
              courseTitle={courseTitle}
              onOpenCourseLesson={openCourseLesson}
              onStartLesson={startTeacherLesson}
              onLessonFinished={markLessonFinished}
              onOpenStudent={openTeacherStudent}
              onOpenGroup={openTeacherGroup}
              startedLessonIds={startedLessonIds}
              patchTeacher={patchTeacher}
              busy={busy}
              runAction={runAction}
            />
          </>
        ) : null}

        {section === 'teacher-students' && canShowStudents(data) ? (
          <>
            <StaffContextHeader
              area={combinedStaff || (canShowCurator(data) && !canShowTeacher(data)) ? 'work' : 'regular'}
            />
            <StaffStudentsPanel
              key={selectedTeacherStudentId ?? 'staff-students'}
              mode={scheduleMode}
              teacherData={data.teacher ?? undefined}
              courseStudents={data.curator?.students ?? []}
              courseTitle={courseTitle}
              busy={busy}
              runAction={runAction}
              initialStudentId={selectedTeacherStudentId}
              onOpenLesson={openTeacherLessonRoom}
              onOpenCourseSection={() => setSection('course-students')}
            />
          </>
        ) : null}

        {section === 'teacher-groups' && canShowTeacher(data) && data.teacher ? (
          <>
            <StaffContextHeader area={combinedStaff ? 'work' : 'regular'} />
            <TeacherGroupsPanel
              key={selectedTeacherGroupId ?? 'teacher-groups'}
              data={data.teacher}
              busy={busy}
              runAction={runAction}
              onOpenStudent={openTeacherStudent}
              onOpenLesson={openTeacherLessonRoom}
              onOpenSchedule={() => setSection('teacher-calendar')}
              initialGroupId={selectedTeacherGroupId}
            />
          </>
        ) : null}

        {section === 'course-list' && data.curator ? (
          <div className="course-page">
            <CourseListPanel
              courseTitle={courseTitle}
              studentCount={data.curator.students.length}
              lessonCount={data.curator.lessons.length}
              onOpenCourse={() => setSection('course-overview')}
            />
          </div>
        ) : null}

        {section === 'course-overview' && data.curator ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorDashboard
              data={data.curator}
              onOpenHomework={() => setSection('course-homework')}
              onOpenStudents={() => setSection('course-students')}
              onOpenLesson={(id) => {
                setSection('course-lessons');
                setSelectedLessonId(id);
              }}
            />
          </div>
        ) : null}

        {section === 'course-students' && data.curator ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorStudentsPanel students={data.curator.students} busy={busy} runAction={runAction} />
          </div>
        ) : null}

        {section === 'course-lessons' && data.curator ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorLessonsPanel
              data={data.curator}
              selectedLessonId={selectedLessonId}
              onSelectLesson={setSelectedLessonId}
              onBack={() => setSelectedLessonId(null)}
              busy={busy}
              runAction={runAction}
            />
          </div>
        ) : null}

        {section === 'course-history' && data.curator ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CourseHistoryPanel lessons={data.curator.lessons} onOpenLesson={openCourseLesson} />
          </div>
        ) : null}

        {section === 'course-homework' && data.curator ? (
          <>
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorHomeworkPanel
              board={data.curator.homeworkBoard}
              busy={busy}
              runAction={runAction}
              rejectTarget={rejectTarget}
              rejectNote={rejectNote}
              onRejectNote={setRejectNote}
              onRejectTarget={setRejectTarget}
            />
          </>
        ) : null}

        {section === 'settings' ? (
          <CuratorSettingsPanel
            curatorName={data.staffName}
            courseTitle={courseTitle}
            sanityWriteEnabled={data.curator?.sanityWriteEnabled ?? false}
          />
        ) : null}

        {openTeacherLesson ? (
          <TeacherLessonRoom
            lesson={openTeacherLesson}
            busy={busy}
            onClose={() => setOpenTeacherLesson(null)}
            runAction={runAction}
          />
        ) : null}
      </main>
    </div>
  );
}
