'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memberHasRole } from '@/lib/bot/roles';
import {
  canReviewHomeworkOnCourse,
  canViewHomeworkProgressOnCourse,
  defaultWebSectionForCourseRole,
  webNavSectionsForCourseRole,
  webSectionNavLabel,
} from '@/lib/staff/course-assignment-ui';
import { buildStaffCabinetPath } from '@/lib/staff/staff-cabinet-url';
import type { StaffCabinetData } from '@/lib/teacher/cabinet-data';
import {
  normalizeCuratorCabinetData,
  type CuratorHomeworkQueueItem,
} from '@/lib/curator/cabinet-data';
import CuratorDashboard from '@/components/curator/CuratorDashboard';
import CuratorLessonsPanel from '@/components/curator/CuratorLessonsPanel';
import CuratorStudentsPanel from '@/components/curator/CuratorStudentsPanel';
import CuratorHomeworkPanel from '@/components/curator/CuratorHomeworkPanel';
import CourseHistoryPanel from './CourseHistoryPanel';
import CourseListPanel from './CourseListPanel';
import StaffContextHeader from './StaffContextHeader';
import TeacherLiveBanner from './TeacherLiveBanner';
import TeacherSchedulePanel from './schedule/TeacherSchedulePanel';
import {
  IconCalendarRef,
  IconChartRef,
  IconCheckRef,
  IconChevronLeftRef,
  IconChevronRightRef,
  IconNoteRef,
  IconPanelRef,
  IconUserRef,
} from './schedule/ScheduleRefIcons';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { StaffRefreshScope, StaffRunAction } from '@/lib/staff/run-action';

export type StaffSection =
  | 'teacher-calendar'
  | 'course-list'
  | 'course-overview'
  | 'course-students'
  | 'course-lessons'
  | 'course-history'
  | 'course-homework';

const SECTION_ICONS: Record<StaffSection, ReactNode> = {
  'teacher-calendar': <IconCalendarRef size={18} />,
  'course-list': <IconPanelRef size={18} />,
  'course-overview': <IconChartRef size={18} />,
  'course-students': <IconUserRef size={18} />,
  'course-lessons': <IconCalendarRef size={18} />,
  'course-history': <IconNoteRef size={18} />,
  'course-homework': <IconCheckRef size={18} />,
};

const SIDEBAR_KEY = 'staff-sidebar-collapsed';
const sidebarListeners = new Set<() => void>();

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    sidebarListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** По умолчанию свёрнута; '0' в localStorage = развёрнута. */
function getSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

function setSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
  sidebarListeners.forEach((listener) => listener());
}

type NavItem = { id: StaffSection; label: string; badge?: number; indent?: boolean };
type NavGroup = { label: string; items: NavItem[]; subLabel?: string };

const STAFF_SECTIONS: StaffSection[] = [
  'teacher-calendar',
  'course-list',
  'course-overview',
  'course-students',
  'course-lessons',
  'course-history',
  'course-homework',
];

const LEGACY_SECTION_MAP: Record<string, StaffSection> = {
  'teacher-home': 'teacher-calendar',
  'teacher-schedule': 'teacher-calendar',
  'teacher-availability': 'teacher-calendar',
  'teacher-working-hours': 'teacher-calendar',
  'teacher-hours': 'teacher-calendar',
  dashboard: 'course-overview',
  lessons: 'course-lessons',
  students: 'course-students',
  homework: 'course-homework',
  'curator-dashboard': 'course-overview',
  'curator-lessons': 'course-lessons',
  'curator-students': 'course-students',
  'curator-homework': 'course-homework',
  'course-schedule': 'course-lessons',
  'teacher-students': 'teacher-calendar',
  'teacher-groups': 'teacher-calendar',
  'teacher-history': 'teacher-calendar',
  settings: 'teacher-calendar',
};

const COURSE_SECTIONS = new Set<StaffSection>([
  'course-list',
  'course-overview',
  'course-students',
  'course-lessons',
  'course-history',
  'course-homework',
]);

function canShowTeacher(data: StaffCabinetData): boolean {
  return Boolean(
    data.teacher && (data.fullStaffPreview || memberHasRole(data.memberRoles, 'teacher')),
  );
}

function hasCourseAssignments(data: StaffCabinetData): boolean {
  return Boolean(
    data.curator && data.curator.assignedCourses.some((c) => c.role === 'curator'),
  );
}

/** Кураторские инструменты на активном курсе (расписание, модули, жизни). */
function canShowCuratorCourseTools(data: StaffCabinetData): boolean {
  if (!data.curator) return false;
  if (data.fullStaffPreview) return true;
  return data.curator.activeCourseRole === 'curator';
}

function canReviewCourseHomework(data: StaffCabinetData): boolean {
  return canReviewHomeworkOnCourse(
    data.curator?.activeCourseRole ?? null,
    data.fullStaffPreview,
  );
}

function canViewCourseHomeworkProgress(data: StaffCabinetData): boolean {
  return canViewHomeworkProgressOnCourse(
    data.curator?.activeCourseRole ?? null,
    data.fullStaffPreview,
  );
}

function canShowSchedule(data: StaffCabinetData): boolean {
  return canShowTeacher(data);
}

function buildStaffNav(data: StaffCabinetData): NavGroup[] {
  const groups: NavGroup[] = [];
  const showTeacher = canShowTeacher(data);
  const showCourseNav = hasCourseAssignments(data) && Boolean(data.curator);
  const combined = showTeacher && showCourseNav;

  if (combined) {
    groups.push({
      label: 'Моя работа',
      items: [
        { id: 'teacher-calendar', label: 'Расписание' },
      ],
    });
  } else if (showTeacher) {
    groups.push({
      label: 'Кабинет преподавателя',
      items: [
        { id: 'teacher-calendar', label: 'Расписание' },
      ],
    });
  }

  if (showCourseNav && data.curator) {
    const courseTitle = data.curator.courseTitle;
    const role = data.curator.activeCourseRole;
    const courseItems: NavItem[] = [{ id: 'course-list', label: 'Мои курсы' }];
    groups.push({
      label: 'Курсы',
      items: courseItems,
      subLabel: data.curator.courseId ? courseTitle : undefined,
    });
    if (data.curator.courseId && role) {
      const sectionIds = webNavSectionsForCourseRole(role, {
        fullPreview: data.fullStaffPreview,
      });
      const subItems: NavItem[] = sectionIds.map((id) => ({
        id: id as StaffSection,
        label: webSectionNavLabel(id, role),
        indent: true,
      }));
      if (subItems.length > 0) {
        groups.push({
          label: courseTitle,
          items: subItems,
        });
      }
    }
  }

  return groups;
}

function defaultSection(data: StaffCabinetData): StaffSection {
  if (canShowSchedule(data)) return 'teacher-calendar';
  if (hasCourseAssignments(data) && data.curator?.activeCourseRole) {
    const sec = defaultWebSectionForCourseRole(data.curator.activeCourseRole, {
      fullPreview: data.fullStaffPreview,
    });
    return sec === 'course-list' ? 'course-list' : sec;
  }
  return 'course-list';
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

function normalizeStaffData(data: StaffCabinetData): StaffCabinetData {
  if (!data.curator) return data;
  return { ...data, curator: normalizeCuratorCabinetData(data.curator) };
}

async function reloadData(
  courseId?: number | null,
  courseRole?: 'curator' | 'check' | null,
): Promise<StaffCabinetData> {
  const params = new URLSearchParams();
  if (courseId != null && Number.isFinite(courseId)) {
    params.set('courseId', String(courseId));
  }
  if (courseRole === 'curator' || courseRole === 'check') {
    params.set('courseRole', courseRole);
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/cabinet/staff/data${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось обновить данные');
  const json = (await res.json()) as StaffCabinetData;
  return normalizeStaffData(json);
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
  initialCourseId?: number | null;
  initialCourseRole?: 'curator' | 'check' | null;
  showCabinetPick?: boolean;
};

export default function StaffShell({
  data: initialData,
  initialSection,
  initialLessonId,
  initialCourseId,
  initialCourseRole,
  showCabinetPick,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState(() => normalizeStaffData(initialData));
  const [activeCourseId, setActiveCourseId] = useState<number | null>(
    initialCourseId ?? initialData.curator?.courseId ?? null,
  );
  const [activeCourseRole, setActiveCourseRole] = useState<'curator' | 'check' | null>(
    initialCourseRole ?? initialData.curator?.activeCourseRole ?? null,
  );
  const [section, setSection] = useState<StaffSection>(() =>
    resolveInitialSection(initialData, initialSection),
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(initialLessonId ?? null);
  const [scheduleFocusLessonId, setScheduleFocusLessonId] = useState<number | null>(null);
  const [, setStartedLessonIds] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState<CuratorHomeworkQueueItem | null>(null);

  const sidebarCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => true);
  const navGroups = useMemo(() => buildStaffNav(data), [data]);
  const courseTitle = data.curator?.courseTitle ?? 'Курс';

  const syncStaffUrl = useCallback(
    (patch: {
      section?: StaffSection;
      courseId?: number | null;
      courseRole?: 'curator' | 'check' | null;
      lesson?: string | null;
    }) => {
      const nextSection = patch.section ?? section;
      const nextCourseId = patch.courseId !== undefined ? patch.courseId : activeCourseId;
      const nextRole = patch.courseRole !== undefined ? patch.courseRole : activeCourseRole;
      const lesson =
        patch.lesson !== undefined
          ? patch.lesson
          : nextSection === 'course-lessons' && selectedLessonId
            ? selectedLessonId
            : null;
      router.replace(
        buildStaffCabinetPath({
          section: nextSection,
          courseId: nextCourseId,
          courseRole: nextRole,
          lesson: lesson ?? undefined,
        }),
        { scroll: false },
      );
    },
    [section, activeCourseId, activeCourseRole, selectedLessonId, router],
  );

  const refresh = useCallback(async (scope: StaffRefreshScope = 'full') => {
    if (scope === 'none') return;
    if (scope === 'teacher') {
      const teacher = await reloadTeacherData();
      setData((prev) => ({ ...prev, teacher }));
      return;
    }
    const next = await reloadData(activeCourseId, activeCourseRole);
    setData(next);
    if (next.curator?.courseId != null) setActiveCourseId(next.curator.courseId);
    if (next.curator?.activeCourseRole) setActiveCourseRole(next.curator.activeCourseRole);
  }, [activeCourseId, activeCourseRole]);

  const patchTeacher = useCallback((patch: (prev: TeacherCabinetData) => TeacherCabinetData) => {
    setData((prev) => {
      if (!prev.teacher) return prev;
      return { ...prev, teacher: patch(prev.teacher) };
    });
  }, []);

  const runAction: StaffRunAction = useCallback(
    async (action, successText, options) => {
      const silent = options?.silent === true;
      if (!silent) setBusy(true);
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
        if (!silent) setBusy(false);
      }
    },
    [refresh],
  );

  const markLessonFinished = useCallback((lessonId: number) => {
    setStartedLessonIds((prev) => {
      if (!prev.has(lessonId)) return prev;
      const next = new Set(prev);
      next.delete(lessonId);
      return next;
    });
  }, []);

  const openCourseLesson = useCallback((sanityId: string) => {
    setSection('course-lessons');
    setSelectedLessonId(sanityId);
  }, []);

  const showTeacherLive =
    Boolean(data.teacher?.currentLesson) &&
    !hasCourseAssignments(data) &&
    section !== 'teacher-calendar';

  const roleLabel = useMemo(() => {
    if (data.fullStaffPreview) return 'Admin · preview';
    const parts: string[] = [];
    if (memberHasRole(data.memberRoles, 'teacher')) parts.push('Преподаватель');
    if (data.curator?.assignedCourses.some((c) => c.role === 'curator')) parts.push('Куратор курса');
    if (data.curator?.assignedCourses.some((c) => c.role === 'check')) parts.push('Проверка ДЗ');
    if (memberHasRole(data.memberRoles, 'staff')) parts.push('Сотрудник');
    return parts.join(' · ') || 'Staff';
  }, [data.fullStaffPreview, data.memberRoles, data.curator?.assignedCourses]);

  useEffect(() => {
    if (section === 'teacher-calendar' && !canShowSchedule(data)) {
      setSection(defaultSection(data));
    }
    if (isCourseSection(section) && !hasCourseAssignments(data)) {
      setSection(defaultSection(data));
    }
    if (section === 'course-overview' && !canShowCuratorCourseTools(data)) {
      setSection(canViewCourseHomeworkProgress(data) ? 'course-homework' : 'course-list');
    }
    if (
      (section === 'course-students' || section === 'course-lessons' || section === 'course-history') &&
      !canShowCuratorCourseTools(data)
    ) {
      setSection('course-list');
    }
    if (section === 'course-homework' && !canViewCourseHomeworkProgress(data)) {
      setSection(defaultSection(data));
    }
  }, [section, data]);

  const handleNavClick = (itemId: StaffSection) => {
    setSection(itemId);
    if (itemId !== 'course-lessons') setSelectedLessonId(null);
    syncStaffUrl({ section: itemId, lesson: itemId === 'course-lessons' ? selectedLessonId : null });
  };

  return (
    <div className={`curator-cabinet staff-cabinet${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className={`curator-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <div className="staff-sidebar-top">
          <div className="curator-brand">
            <span className="curator-brand-name">District</span>
            <span className="curator-brand-role">{roleLabel}</span>
          </div>
          <button
            type="button"
            className="staff-sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            data-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {sidebarCollapsed ? <IconChevronRightRef size={16} /> : <IconChevronLeftRef size={16} />}
          </button>
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
                  title={sidebarCollapsed ? undefined : item.label}
                  aria-label={item.label}
                  data-label={item.label}
                >
                  <span className="staff-nav-icon">{SECTION_ICONS[item.id]}</span>
                  <span className="staff-nav-label">{item.label}</span>
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
          <span className="staff-sidebar-avatar" aria-hidden="true">
            {(data.staffName ?? 'С').trim().charAt(0).toUpperCase()}
          </span>
          <p>{data.staffName ?? 'Сотрудник'}</p>
        </div>
      </aside>

      <main className={`curator-main${section === 'teacher-calendar' ? ' curator-main--schedule' : ''}`}>
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
            <TeacherSchedulePanel
              teacherData={data.teacher ?? undefined}
              onLessonFinished={markLessonFinished}
              showCancelled={data.fullStaffPreview}
              focusLessonId={scheduleFocusLessonId}
              onFocusLessonHandled={() => setScheduleFocusLessonId(null)}
              patchTeacher={patchTeacher}
              busy={busy}
              runAction={runAction}
            />
          </>
        ) : null}

        {section === 'course-list' && data.curator ? (
          <div className="course-page">
            <CourseListPanel
              courses={
                data.curator.assignedCourses.length > 0
                  ? data.curator.assignedCourses.map((c) => ({
                      courseId: c.courseId,
                      title: c.title,
                      studentCount: c.studentCount,
                      lessonCount: c.lessonCount,
                      role: c.role,
                    }))
                  : data.curator.courseId && data.curator.activeCourseRole
                    ? [
                        {
                          courseId: data.curator.courseId,
                          title: courseTitle,
                          studentCount: data.curator.students.length,
                          lessonCount: data.curator.lessons.length,
                          role: data.curator.activeCourseRole,
                        },
                      ]
                    : []
              }
              onOpenCourse={(courseId, role) => {
                setActiveCourseId(courseId);
                setActiveCourseRole(role);
                void reloadData(courseId, role)
                  .then((next) => {
                    setData(next);
                    const sec = defaultWebSectionForCourseRole(role, {
                      fullPreview: next.fullStaffPreview,
                    }) as StaffSection;
                    setSection(sec);
                    syncStaffUrl({ section: sec, courseId, courseRole: role, lesson: null });
                  })
                  .catch(() => undefined);
              }}
            />
          </div>
        ) : null}

        {section === 'course-overview' && data.curator && canShowCuratorCourseTools(data) ? (
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

        {section === 'course-students' && data.curator && canShowCuratorCourseTools(data) ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorStudentsPanel students={data.curator.students} />
          </div>
        ) : null}

        {section === 'course-lessons' && data.curator && canShowCuratorCourseTools(data) ? (
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

        {section === 'course-history' && data.curator && canShowCuratorCourseTools(data) ? (
          <div className="course-page">
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CourseHistoryPanel lessons={data.curator.lessons} onOpenLesson={openCourseLesson} />
          </div>
        ) : null}

        {section === 'course-homework' && data.curator && canViewCourseHomeworkProgress(data) ? (
          <>
            <StaffContextHeader area="course" courseTitle={courseTitle} />
            <CuratorHomeworkPanel
              board={data.curator.homeworkBoard}
              courseId={data.curator.courseId}
              busy={busy}
              runAction={runAction}
              rejectTarget={rejectTarget}
              rejectNote={rejectNote}
              onRejectNote={setRejectNote}
              onRejectTarget={setRejectTarget}
              readOnly={!canReviewCourseHomework(data)}
            />
          </>
        ) : null}

      </main>
    </div>
  );
}







