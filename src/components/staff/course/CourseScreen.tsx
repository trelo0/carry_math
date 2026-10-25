'use client';

import { useEffect, useMemo } from 'react';
import type { CuratorCabinetData } from '@/lib/curator/cabinet-data';
import type { StaffRunAction } from '@/lib/staff/run-action';
import {
  IconCalendarRef,
  IconChevronLeftRef,
  IconUserRef,
  IconUsersRef,
} from '../schedule/ScheduleRefIcons';
import CourseLessonSettings from './CourseLessonSettings';
import CourseLessonsTab from './CourseLessonsTab';
import CourseOverviewTab from './CourseOverviewTab';
import CourseStudentsTab from './CourseStudentsTab';
import { COURSE_TABS, lessonWord, studentWord, type CourseTab } from './course-utils';

type Props = {
  data: CuratorCabinetData;
  tab: CourseTab;
  onTabChange: (tab: CourseTab) => void;
  /** Занятие, открытое в выезжающей панели справа. */
  drawerLessonId: string | null;
  onOpenDrawer: (id: string) => void;
  onCloseDrawer: () => void;
  /** Показывается, только если у куратора несколько курсов. */
  onBack?: () => void;
  busy: boolean;
  runAction: StaffRunAction;
};

export default function CourseScreen({
  data,
  tab,
  onTabChange,
  drawerLessonId,
  onOpenDrawer,
  onCloseDrawer,
  onBack,
  busy,
  runAction,
}: Props) {
  // Настройка занятия (и из «Обзора», и из «Занятий») открывается в выезжающей панели справа.
  const drawerLesson = useMemo(
    () => data.lessons.find((l) => l.sanityId === drawerLessonId) ?? null,
    [data.lessons, drawerLessonId],
  );

  useEffect(() => {
    if (!drawerLesson) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerLesson, onCloseDrawer]);

  const studentCount = data.dashboard.studentCount ?? data.students.length;
  const live = data.dashboard.liveNow > 0;
  // Куратор курса (по назначению), а не тот, кто сейчас смотрит кабинет.
  const curatorLabel = data.courseCuratorName ?? null;

  return (
    <div className="cr-root">
      <header className="cr-hero">
        {onBack ? (
          <button type="button" className="cr-back" onClick={onBack}>
            <IconChevronLeftRef size={14} /> Назад к курсам
          </button>
        ) : null}
        <div className="cr-hero-row">
          <h1 className="cr-title">{data.courseTitle}</h1>
          {live ? <span className="cr-pill is-live">В эфире</span> : null}
        </div>
        <div className="cr-facts">
          <span className="cr-fact">
            <IconCalendarRef size={15} />
            {data.lessons.length} {lessonWord(data.lessons.length)}
          </span>
          <span className="cr-fact">
            <IconUsersRef size={15} />
            {studentCount} {studentWord(studentCount)}
          </span>
          {curatorLabel ? (
            <span className="cr-fact">
              <IconUserRef size={15} />
              Куратор: {curatorLabel}
            </span>
          ) : null}
        </div>
      </header>

      <div className="cr-tabbar" role="tablist" aria-label="Разделы курса">
        {COURSE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`cr-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="cr-body">
        {tab === 'overview' ? <CourseOverviewTab data={data} onOpenLesson={onOpenDrawer} /> : null}
        {tab === 'lessons' ? (
          <CourseLessonsTab data={data} selectedLessonId={drawerLessonId} onSelectLesson={onOpenDrawer} />
        ) : null}
        {tab === 'students' ? <CourseStudentsTab students={data.students} /> : null}
      </div>

      {drawerLesson ? (
        <div className="cr-drawer-layer" role="dialog" aria-modal="true" aria-label="Настройки занятия">
          <button type="button" className="cr-drawer-backdrop" onClick={onCloseDrawer} aria-label="Закрыть панель" />
          <aside className="cr-drawer">
            <CourseLessonSettings
              data={data}
              lesson={drawerLesson}
              variant="drawer"
              onClose={onCloseDrawer}
              busy={busy}
              runAction={runAction}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
