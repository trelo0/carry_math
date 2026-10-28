'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { CABINETS_RETURN_HREF, type CabinetPreviewRole } from '@/lib/admin/settings-sections';
import { useRouter } from 'next/navigation';
import { memberHasRole } from '@/lib/bot/roles';
import { buildStaffCabinetPath } from '@/lib/staff/staff-cabinet-url';
import type { StaffCabinetData } from '@/lib/teacher/cabinet-data';
import { normalizeCuratorCabinetData, type CuratorCabinetData } from '@/lib/curator/cabinet-data';
import CourseListPanel from './CourseListPanel';
import CourseScreen from './course/CourseScreen';
import {
  legacySectionTab,
  parseCourseTab,
  type CourseTab,
} from './course/course-utils';
import TeacherLiveBanner from './TeacherLiveBanner';
import TeacherSchedulePanel from './schedule/TeacherSchedulePanel';
import {
  IconCalendarRef,
  IconChevronLeftRef,
  IconChevronRightRef,
  IconPanelRef,
} from './schedule/ScheduleRefIcons';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { StaffRefreshScope, StaffRunAction } from '@/lib/staff/run-action';

/** Два раздела: расписание и единая страница «Курс» (вкладки внутри). */
export type StaffSection = 'teacher-calendar' | 'course';

const SECTION_ICONS: Record<StaffSection, ReactNode> = {
  'teacher-calendar': <IconCalendarRef size={18} />,
  course: <IconPanelRef size={18} />,
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

const STAFF_SECTIONS: StaffSection[] = ['teacher-calendar', 'course'];

const LEGACY_SECTION_MAP: Record<string, StaffSection> = {
  'teacher-home': 'teacher-calendar',
  'teacher-schedule': 'teacher-calendar',
  'teacher-availability': 'teacher-calendar',
  'teacher-working-hours': 'teacher-calendar',
  'teacher-hours': 'teacher-calendar',
  dashboard: 'course',
  lessons: 'course',
  students: 'course',
  homework: 'course',
  'curator-dashboard': 'course',
  'curator-lessons': 'course',
  'curator-students': 'course',
  'curator-homework': 'course',
  'course-list': 'course',
  'course-overview': 'course',
  'course-lessons': 'course',
  'course-students': 'course',
  'course-history': 'course',
  'course-homework': 'course',
  'course-schedule': 'course',
  'teacher-students': 'teacher-calendar',
  'teacher-groups': 'teacher-calendar',
  'teacher-history': 'teacher-calendar',
  settings: 'teacher-calendar',
};

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

/** Курсы, где сотрудник — куратор (роль «проверка ДЗ» живёт только в Telegram). */
function curatorCourses(data: StaffCabinetData) {
  return (data.curator?.assignedCourses ?? []).filter((c) => c.role === 'curator');
}

function canShowSchedule(data: StaffCabinetData): boolean {
  return canShowTeacher(data);
}

function buildStaffNav(data: StaffCabinetData, previewRole: StaffPreviewRole): NavGroup[] {
  const groups: NavGroup[] = [];
  const showTeacher =
    previewRole === 'curator' ? false : previewRole === 'teacher' ? canShowTeacher(data) : canShowTeacher(data);
  const showCourseNav =
    previewRole === 'teacher'
      ? false
      : previewRole === 'curator'
        ? Boolean(data.curator) && (hasCourseAssignments(data) || data.fullStaffPreview)
        : hasCourseAssignments(data) && Boolean(data.curator);
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

  if (showCourseNav) {
    groups.push({
      label: 'Курсы',
      items: [{ id: 'course', label: 'Курсы' }],
    });
  }

  return groups;
}

type StaffPreviewRole = CabinetPreviewRole | null;

function defaultSection(data: StaffCabinetData, previewRole: StaffPreviewRole): StaffSection {
  if (previewRole === 'curator') return 'course';
  if (previewRole === 'teacher') return 'teacher-calendar';
  if (canShowSchedule(data)) return 'teacher-calendar';
  return 'course';
}

function resolveInitialSection(
  data: StaffCabinetData,
  initial: string | undefined,
  previewRole: StaffPreviewRole,
): StaffSection {
  const fallback = defaultSection(data, previewRole);
  if (!initial) return fallback;
  const mapped = LEGACY_SECTION_MAP[initial] ?? initial;
  if (!STAFF_SECTIONS.includes(mapped as StaffSection)) return fallback;
  const section = mapped as StaffSection;
  if (previewRole === 'teacher' && section === 'course') return 'teacher-calendar';
  if (previewRole === 'curator' && section === 'teacher-calendar') return 'course';
  return section;
}

function isCourseSection(section: StaffSection): boolean {
  return section === 'course';
}

function normalizeStaffData(data: StaffCabinetData): StaffCabinetData {
  if (!data.curator) return data;
  return { ...data, curator: normalizeCuratorCabinetData(data.curator) };
}

/** Лёгкий ответ приходит без списка курсов — оставляем прежний. */
function mergeLight(prev: StaffCabinetData, next: StaffCabinetData): StaffCabinetData {
  if (!next.curator || !prev.curator) return { ...next, teacher: next.teacher ?? prev.teacher };
  return {
    ...next,
    teacher: next.teacher ?? prev.teacher,
    curator: { ...next.curator, assignedCourses: prev.curator.assignedCourses },
  };
}

async function reloadData(
  courseId?: number | null,
  courseRole?: 'curator' | 'check' | null,
): Promise<StaffCabinetData> {
  const params = new URLSearchParams();
  params.set('light', '1');
  if (courseId != null && Number.isFinite(courseId)) {
    params.set('courseId', String(courseId));
  }
  if (courseRole === 'curator' || courseRole === 'check') {
    params.set('courseRole', courseRole);
  }

  const qs = `?${params.toString()}`;
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
  initialTab?: string;
  initialLessonId?: string;
  initialCourseId?: number | null;
  initialCourseRole?: 'curator' | 'check' | null;
  cabinetPreview?: StaffPreviewRole;
  showCabinetPick?: boolean;
};

export default function StaffShell({
  data: initialData,
  initialSection,
  initialTab,
  initialLessonId,
  initialCourseId,
  initialCourseRole,
  cabinetPreview = null,
  showCabinetPick,
}: Props) {
  const previewRole: StaffPreviewRole =
    cabinetPreview === 'curator' || cabinetPreview === 'teacher' ? cabinetPreview : null;
  const router = useRouter();
  const [data, setData] = useState(() => normalizeStaffData(initialData));
  const [activeCourseId, setActiveCourseId] = useState<number | null>(
    initialCourseId ?? initialData.curator?.courseId ?? null,
  );
  const [activeCourseRole, setActiveCourseRole] = useState<'curator' | 'check' | null>(
    initialCourseRole ?? initialData.curator?.activeCourseRole ?? null,
  );
  const [section, setSection] = useState<StaffSection>(() =>
    resolveInitialSection(initialData, initialSection, previewRole),
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(initialLessonId ?? null);
  const [courseTab, setCourseTab] = useState<CourseTab>(
    () =>
      parseCourseTab(initialTab) ??
      (initialLessonId ? 'lessons' : null) ??
      legacySectionTab(initialSection) ??
      'overview',
  );
  // Несколько курсов: сначала список, потом экран курса. Один курс — сразу экран.
  const [courseOpen, setCourseOpen] = useState(
    () => curatorCourses(initialData).length <= 1 || initialCourseId != null,
  );
  const [scheduleFocusLessonId, setScheduleFocusLessonId] = useState<number | null>(null);
  const [, setStartedLessonIds] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  const sidebarCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => true);
  const navGroups = useMemo(() => buildStaffNav(data, previewRole), [data, previewRole]);
  const ownCourses = useMemo(() => curatorCourses(data), [data]);
  const showCourseList = !courseOpen && ownCourses.length > 1;

  const syncStaffUrl = useCallback(
    (patch: {
      section?: StaffSection;
      courseId?: number | null;
      courseRole?: 'curator' | 'check' | null;
      tab?: CourseTab | null;
      lesson?: string | null;
    }) => {
      const nextSection = patch.section ?? section;
      const nextCourseId = patch.courseId !== undefined ? patch.courseId : activeCourseId;
      const nextRole = patch.courseRole !== undefined ? patch.courseRole : activeCourseRole;
      const isCourse = nextSection === 'course';
      const tab = patch.tab !== undefined ? patch.tab : isCourse ? courseTab : null;
      const lesson =
        patch.lesson !== undefined ? patch.lesson : isCourse && selectedLessonId ? selectedLessonId : null;
      router.replace(
        buildStaffCabinetPath({
          section: nextSection,
          courseId: isCourse ? nextCourseId : null,
          courseRole: isCourse ? nextRole : null,
          tab: tab ?? undefined,
          lesson: lesson ?? undefined,
          cabinetPreview: previewRole,
        }),
        { scroll: false },
      );
    },
    [section, activeCourseId, activeCourseRole, courseTab, selectedLessonId, router, previewRole],
  );

  const refresh = useCallback(async (scope: StaffRefreshScope = 'full') => {
    if (scope === 'none') return;
    if (scope === 'teacher') {
      const teacher = await reloadTeacherData();
      setData((prev) => ({ ...prev, teacher }));
      return;
    }
    const next = await reloadData(activeCourseId, activeCourseRole);
    setData((prev) => mergeLight(prev, next));
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

  /** Выезжающая панель настроек занятия — открывается поверх текущей вкладки (вкладка не меняется). */
  const openCourseLesson = useCallback(
    (sanityId: string) => {
      setSelectedLessonId(sanityId);
      syncStaffUrl({ section: 'course', lesson: sanityId });
    },
    [syncStaffUrl],
  );

  const closeCourseLesson = useCallback(() => {
    setSelectedLessonId(null);
    syncStaffUrl({ section: 'course', lesson: null });
  }, [syncStaffUrl]);

  const changeCourseTab = useCallback(
    (tab: CourseTab) => {
      setCourseTab(tab);
      setSelectedLessonId(null);
      syncStaffUrl({ section: 'course', tab, lesson: null });
    },
    [syncStaffUrl],
  );

  const courseCache = useRef(new Map<number, CuratorCabinetData>());
  useEffect(() => {
    const c = data.curator;
    if (c?.courseId != null) courseCache.current.set(c.courseId, c);
  }, [data.curator]);

  const openCourse = useCallback(
    (courseId: number, role: 'curator' | 'check') => {
      // Экран курса открываем сразу (скелетон), данные подгружаем в фоне.
      setActiveCourseId(courseId);
      setActiveCourseRole(role);
      setSelectedLessonId(null);
      setCourseTab('overview');
      setCourseError(null);
      // Уже открывали этот курс — показываем сразу, обновляем в фоне.
      const cached = courseCache.current.get(courseId);
      if (cached) {
        setData((prev) =>
          prev.curator ? { ...prev, curator: { ...cached, assignedCourses: prev.curator.assignedCourses } } : prev,
        );
        setCourseLoading(false);
      } else {
        setCourseLoading(true);
      }
      setCourseOpen(true);
      syncStaffUrl({
        section: 'course',
        courseId,
        courseRole: role,
        tab: 'overview',
        lesson: null,
      });
      void reloadData(courseId, role)
        .then((next) => setData((prev) => mergeLight(prev, next)))
        .catch(() => {
          setCourseError('Не удалось загрузить курс. Попробуйте ещё раз.');
          setCourseOpen(false);
        })
        .finally(() => setCourseLoading(false));
    },
    [syncStaffUrl],
  );

  // Единственный курс всегда открыт; данные подгружаем, если сервер отдал другой курс.
  const autoLoadedCourse = useRef<number | null>(null);
  useEffect(() => {
    if (section !== 'course' || ownCourses.length !== 1) return;
    const only = ownCourses[0];
    if (data.curator?.courseId === only.courseId || autoLoadedCourse.current === only.courseId) return;
    autoLoadedCourse.current = only.courseId;
    void reloadData(only.courseId, 'curator')
      .then((next) => {
        setData((prev) => mergeLight(prev, next));
        setActiveCourseId(only.courseId);
        setActiveCourseRole('curator');
      })
      .catch(() => undefined);
  }, [section, ownCourses, data.curator?.courseId]);

  const showTeacherLive =
    Boolean(data.teacher?.currentLesson) &&
    !hasCourseAssignments(data) &&
    section !== 'teacher-calendar';

  const roleLabel = useMemo(() => {
    if (previewRole === 'curator') return 'Просмотр · куратор';
    if (previewRole === 'teacher') return 'Просмотр · преподаватель';
    if (data.fullStaffPreview) return 'Admin · preview';
    const parts: string[] = [];
    if (memberHasRole(data.memberRoles, 'teacher')) parts.push('Преподаватель');
    if (data.curator?.assignedCourses.some((c) => c.role === 'curator')) parts.push('Куратор курса');
    if (data.curator?.assignedCourses.some((c) => c.role === 'check')) parts.push('Проверка ДЗ');
    if (memberHasRole(data.memberRoles, 'staff')) parts.push('Сотрудник');
    return parts.join(' · ') || 'Staff';
  }, [previewRole, data.fullStaffPreview, data.memberRoles, data.curator?.assignedCourses]);

  useEffect(() => {
    if (previewRole === 'curator' && section === 'teacher-calendar') {
      setSection('course');
      return;
    }
    if (previewRole === 'teacher' && section === 'course') {
      setSection('teacher-calendar');
      return;
    }
    if (section === 'teacher-calendar' && !canShowSchedule(data)) {
      setSection(defaultSection(data, previewRole));
    }
    if (isCourseSection(section) && !hasCourseAssignments(data) && previewRole !== 'curator') {
      setSection(defaultSection(data, previewRole));
    }
  }, [section, data, previewRole]);

  const handleNavClick = (itemId: StaffSection) => {
    setSection(itemId);
    if (itemId === 'course') {
      // Клик по «Курсы» при нескольких курсах возвращает к списку.
      const backToList = ownCourses.length > 1;
      if (backToList) {
        setCourseOpen(false);
        setSelectedLessonId(null);
      }
      syncStaffUrl({
        section: 'course',
        courseId: backToList ? null : activeCourseId,
        tab: backToList ? null : courseTab,
        lesson: backToList ? null : selectedLessonId,
      });
      return;
    }
    syncStaffUrl({ section: itemId });
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
          {showCabinetPick ? (
            <Link href={CABINETS_RETURN_HREF} className="cabinet-return-btn curator-pick-link">
              <span className="cabinet-return-btn__icon" aria-hidden="true">
                ←
              </span>
              <span className="cabinet-return-btn__text">В настройки</span>
            </Link>
          ) : null}
          <span className="staff-sidebar-avatar" aria-hidden="true">
            {(data.staffName ?? 'С').trim().charAt(0).toUpperCase()}
          </span>
          <p>{data.staffName ?? 'Сотрудник'}</p>
        </div>
      </aside>

      <main
        className={`curator-main${section === 'teacher-calendar' ? ' curator-main--schedule' : ''}${isCourseSection(section) ? ' curator-main--course' : ''}`}
      >
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
              showCancelled={data.fullStaffPreview}
              onLessonFinished={markLessonFinished}
              focusLessonId={scheduleFocusLessonId}
              onFocusLessonHandled={() => setScheduleFocusLessonId(null)}
              patchTeacher={patchTeacher}
              busy={busy}
              runAction={runAction}
            />
          </>
        ) : null}

        {isCourseSection(section) && data.curator && showCourseList ? (
          <CourseListPanel
            courses={ownCourses.map((c) => ({
              courseId: c.courseId,
              title: c.title,
              studentCount: c.studentCount,
              lessonCount: c.lessonCount,
              role: c.role,
            }))}
            onOpenCourse={openCourse}
          />
        ) : null}

        {isCourseSection(section) && courseError && showCourseList ? (
          <div className="curator-warn">{courseError}</div>
        ) : null}

        {isCourseSection(section) && courseLoading ? (
          <div className="cr-root" aria-busy="true" aria-label="Загрузка курса">
            <div className="cr-skel cr-skel--title" />
            <div className="cr-skel cr-skel--tabs" />
            <div className="cr-skel cr-skel--block" />
            <div className="cr-skel cr-skel--block cr-skel--short" />
          </div>
        ) : null}

        {isCourseSection(section) &&
        !courseLoading &&
        data.curator &&
        !showCourseList &&
        canShowCuratorCourseTools(data) ? (
          <CourseScreen
            key={data.curator.courseId ?? 'course'}
            data={data.curator}
            tab={courseTab}
            onTabChange={changeCourseTab}
            drawerLessonId={selectedLessonId}
            onOpenDrawer={openCourseLesson}
            onCloseDrawer={closeCourseLesson}
            onBack={
              ownCourses.length > 1
                ? () => {
                    setCourseOpen(false);
                    setSelectedLessonId(null);
                    syncStaffUrl({ section: 'course', courseId: null, tab: null, lesson: null });
                  }
                : undefined
            }
            busy={busy}
            runAction={runAction}
          />
        ) : null}

      </main>
    </div>
  );
}







