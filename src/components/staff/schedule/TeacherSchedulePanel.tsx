'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StaffRunAction } from '@/lib/staff/run-action';
import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import type { TeacherCabinetData, TeacherDaySlot, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import {
  getScheduleFilters,
  isScheduleFilterValid,
  type StaffScheduleMode,
} from '@/lib/teacher/schedule-config';
import type { ScheduleEvent, ScheduleFilter, ScheduleFormKind, ScheduleViewMode } from '@/lib/teacher/schedule-types';
import {
  addDays,
  buildScheduleEvents,
  filterScheduleEvents,
  formatNavDateLong,
  freeSlotsForDay,
  hideReplacedCancelledEvents,
  getWeekDays,
  mapTeacherLessonToEvent,
  startOfWeek,
} from '@/lib/teacher/schedule-utils';
import ScheduleAddModal from './ScheduleAddModal';
import ScheduleLessonFromSlotModal from './ScheduleLessonFromSlotModal';
import ScheduleAutoFillModal from './ScheduleAutoFillModal';
import ScheduleDaySettingsPanel from './ScheduleDaySettingsPanel';
import ScheduleDayGrid, { dayHeadingUpper } from './ScheduleDayGrid';
import ScheduleGrid from './ScheduleGrid';
import ScheduleSidePanel from './ScheduleSidePanel';
import ScheduleSlotFormModal from './ScheduleSlotFormModal';
import ScheduleSlotSidePanel from './ScheduleSlotSidePanel';
import ScheduleWeekStrip from './ScheduleWeekStrip';
import ScheduleHistoryList from './ScheduleHistoryList';
import { IconCalendar } from './ScheduleIcons';

type Props = {
  mode: StaffScheduleMode;
  teacherData?: TeacherCabinetData;
  courseLessons?: CuratorLessonView[];
  courseTitle: string;
  onOpenCourseLesson?: (sanityId: string) => void;
  onStartLesson?: (lesson: TeacherLessonView) => void;
  onLessonFinished?: (lessonId: number) => void;
  onOpenStudent?: (telegramId: number) => void;
  onOpenGroup?: (groupId: number) => void;
  startedLessonIds?: ReadonlySet<number>;
  focusLessonId?: number | null;
  onFocusLessonHandled?: () => void;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  busy: boolean;
  runAction: StaffRunAction;
};

export default function TeacherSchedulePanel({
  mode,
  teacherData,
  courseLessons = [],
  courseTitle,
  onOpenCourseLesson,
  onStartLesson,
  onLessonFinished,
  onOpenStudent,
  onOpenGroup,
  startedLessonIds,
  focusLessonId,
  onFocusLessonHandled,
  patchTeacher,
  busy,
  runAction,
}: Props) {
  const filters = useMemo(() => getScheduleFilters(mode), [mode]);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('day');
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TeacherDaySlot | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<ScheduleFormKind>('individual');
  const [lessonFromSlot, setLessonFromSlot] = useState<TeacherDaySlot | null>(null);
  const [slotFormOpen, setSlotFormOpen] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [replacementDraft, setReplacementDraft] = useState<{
    date: Date;
    startTime: string;
    endTime: string;
    kind: 'individual' | 'group';
    studentTelegramId?: number | null;
    groupId?: number | null;
    replacesLessonId?: number;
  } | null>(null);
  const activeFilter = isScheduleFilterValid(mode, filter) ? filter : 'all';

  const scheduleRunAction: StaffRunAction = useCallback(
    (action, successText, options) =>
      runAction(action, successText, { refresh: options?.refresh ?? 'teacher', awaitRefresh: false, ...options }),
    [runAction],
  );

  const weekStart = useMemo(() => startOfWeek(selectedDay), [selectedDay]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const daySlots = teacherData?.daySlots ?? [];

  const allEvents = useMemo(() => {
    const ordinaryLessons = teacherData?.allLessons ?? [];
    if (mode === 'teacher') {
      return ordinaryLessons
        .map(mapTeacherLessonToEvent)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return buildScheduleEvents(ordinaryLessons, courseLessons, courseTitle);
  }, [mode, teacherData?.allLessons, courseLessons, courseTitle]);

  useEffect(() => {
    if (!selectedEvent) return;
    const updated = allEvents.find((item) => item.id === selectedEvent.id);
    if (updated) setSelectedEvent(updated);
  }, [allEvents, selectedEvent?.id]);

  useEffect(() => {
    if (!selectedSlot) return;
    const updated = daySlots.find((item) => item.id === selectedSlot.id);
    if (updated) setSelectedSlot(updated);
  }, [daySlots, selectedSlot?.id]);

  useEffect(() => {
    if (focusLessonId == null) return;
    const match = allEvents.find((event) => event.lessonId === focusLessonId);
    if (!match) {
      onFocusLessonHandled?.();
      return;
    }
    setViewMode('day');
    setSelectedDay(new Date(match.startsAt));
    setSelectedEvent(match);
    setSelectedSlot(null);
    onFocusLessonHandled?.();
  }, [focusLessonId, allEvents, onFocusLessonHandled]);

  const visibleEvents = useMemo(
    () => filterScheduleEvents(allEvents, activeFilter),
    [allEvents, activeFilter],
  );

  const calendarEvents = useMemo(
    () => hideReplacedCancelledEvents(visibleEvents),
    [visibleEvents],
  );

  const freeSlots = useMemo(
    () => freeSlotsForDay(daySlots, selectedDay, allEvents),
    [daySlots, selectedDay, allEvents],
  );

  const goToday = () => setSelectedDay(new Date());

  const shift = (delta: number) => {
    setSelectedDay((prev) => addDays(prev, viewMode === 'week' ? delta * 7 : delta));
  };

  const pickDay = (day: Date) => {
    setSelectedDay(day);
    setSelectedEvent(null);
    setSelectedSlot(null);
  };

  const selectEvent = (event: ScheduleEvent) => {
    setSelectedEvent(event);
    setSelectedSlot(null);
  };

  const selectSlot = (slot: TeacherDaySlot) => {
    setSelectedSlot(slot);
    setSelectedEvent(null);
  };

  const openAddLessonFromSlot = (slot: TeacherDaySlot) => {
    setLessonFromSlot(slot);
  };

  const isDayView = viewMode === 'day';
  const isHistoryView = activeFilter === 'history';
  const showTeacherSettings = Boolean(teacherData);

  return (
    <div className="curator-panel sched-page has-aside">
      <header className="sched-head">
        <div className="sched-head-row">
          <div className="sched-head-title-row">
            <h1 className="sched-head-title">Расписание</h1>
            <div className="sched-view-tabs sched-view-tabs--inline" role="tablist" aria-label="Режим">
              <button
                type="button"
                className={`sched-view-tab${viewMode === 'week' ? ' is-active' : ''}`}
                onClick={() => setViewMode('week')}
              >
                Неделя
              </button>
              <button
                type="button"
                className={`sched-view-tab${isDayView ? ' is-active' : ''}`}
                onClick={() => setViewMode('day')}
              >
                День
              </button>
            </div>
          </div>

          <div className="sched-head-right">
            <div className="sched-date-nav">
              <button type="button" className="sched-icon-btn" onClick={() => shift(-1)} aria-label="Назад">
                ←
              </button>
              <div className="sched-date-pill">
                <IconCalendar />
                <span>{formatNavDateLong(selectedDay)}</span>
              </div>
              <button type="button" className="sched-icon-btn" onClick={() => shift(1)} aria-label="Вперёд">
                →
              </button>
            </div>
            <button type="button" className="sched-btn sched-btn--accent" onClick={goToday}>
              Сегодня
            </button>
            {showTeacherSettings ? (
              <button
                type="button"
                className="sched-btn sched-btn--outline-teal"
                onClick={() => {
                  setReplacementDraft(null);
                  setAddKind('individual');
                  setAddOpen(true);
                }}
              >
                + Занятие
              </button>
            ) : null}
          </div>
        </div>

        <div className="sched-filters" role="tablist" aria-label="Фильтры">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeFilter === item.id}
              className={`sched-filter${activeFilter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="sched-body">
        <div className="sched-main">
          {isHistoryView ? (
            <div className="sched-day-card sched-history-card">
              <header className="sched-day-card-head">
                <h2>История</h2>
                <p className="sched-history-lead">Завершённые, отменённые и прошедшие занятия</p>
              </header>
              <ScheduleHistoryList
                events={calendarEvents}
                selectedEventId={selectedEvent?.id ?? null}
                onSelectEvent={selectEvent}
              />
            </div>
          ) : isDayView ? (
            <div className="sched-day-card">
              <ScheduleWeekStrip
                days={weekDays}
                selectedDay={selectedDay}
                events={calendarEvents}
                onSelectDay={pickDay}
              />
              <header className="sched-day-card-head">
                <h2>{dayHeadingUpper(selectedDay)}</h2>
              </header>
              <ScheduleDayGrid
                day={selectedDay}
                events={calendarEvents}
                daySlots={daySlots}
                selectedEventId={selectedEvent?.id ?? null}
                selectedSlotId={selectedSlot?.id ?? null}
                onSelectEvent={selectEvent}
                onSelectFreeSlot={showTeacherSettings ? selectSlot : undefined}
              />
            </div>
          ) : (
            <ScheduleGrid
              days={weekDays}
              events={calendarEvents}
              daySlots={daySlots}
              selectedDay={selectedDay}
              selectedEventId={selectedEvent?.id ?? null}
              selectedSlotId={selectedSlot?.id ?? null}
              onSelectDay={pickDay}
              onSelectEvent={selectEvent}
              onSelectFreeSlot={showTeacherSettings ? selectSlot : undefined}
            />
          )}
        </div>

        {selectedEvent ? (
          <ScheduleSidePanel
            event={selectedEvent}
            teacherData={teacherData}
            patchTeacher={patchTeacher}
            busy={busy}
            startedLessonIds={startedLessonIds ?? new Set()}
            onClose={() => setSelectedEvent(null)}
            onOpenCourseLesson={onOpenCourseLesson}
            daySlots={daySlots}
            allEvents={allEvents}
            onStartLesson={onStartLesson}
            onLessonFinished={onLessonFinished}
            onOpenStudent={onOpenStudent}
            onOpenGroup={onOpenGroup}
            onPlanReplacementLesson={(draft) => {
              setReplacementDraft(draft);
              setAddKind(draft.kind);
              setAddOpen(true);
              setSelectedEvent(null);
            }}
            runAction={scheduleRunAction}
          />
        ) : selectedSlot && showTeacherSettings ? (
          <ScheduleSlotSidePanel
            slot={selectedSlot}
            events={allEvents}
            allDaySlots={daySlots}
            busy={busy}
            patchTeacher={patchTeacher}
            runAction={scheduleRunAction}
            onClose={() => setSelectedSlot(null)}
            onDeleted={() => setSelectedSlot(null)}
            onAddLesson={openAddLessonFromSlot}
          />
        ) : isHistoryView ? (
          <aside className="sched-aside">
            <p className="sched-aside-muted">Выберите занятие в списке, чтобы открыть детали.</p>
          </aside>
        ) : (
          <ScheduleDaySettingsPanel
            day={selectedDay}
            freeSlots={freeSlots}
            showSettings={showTeacherSettings}
            onAddSlot={() => setSlotFormOpen(true)}
            onAutoFill={() => setAutoFillOpen(true)}
            onSelectSlot={selectSlot}
          />
        )}
      </div>

      {addOpen && teacherData ? (
        <ScheduleAddModal
          key={
            replacementDraft
              ? `replace-${replacementDraft.startTime}-${replacementDraft.endTime}`
              : `add-${addKind}`
          }
          data={teacherData}
          events={allEvents}
          daySlots={daySlots}
          initialDate={replacementDraft?.date ?? selectedDay}
          initialKind={replacementDraft?.kind ?? addKind}
          initialStartTime={replacementDraft?.startTime}
          initialEndTime={replacementDraft?.endTime}
          initialStudentId={
            replacementDraft?.studentTelegramId ? String(replacementDraft.studentTelegramId) : ''
          }
          initialGroupId={replacementDraft?.groupId ? String(replacementDraft.groupId) : ''}
          replacesLessonId={replacementDraft?.replacesLessonId}
          busy={busy}
          patchTeacher={patchTeacher}
          onClose={() => {
            setAddOpen(false);
            setReplacementDraft(null);
          }}
          runAction={scheduleRunAction}
        />
      ) : null}

      {lessonFromSlot && teacherData ? (
        <ScheduleLessonFromSlotModal
          data={teacherData}
          slot={lessonFromSlot}
          events={allEvents}
          daySlots={daySlots}
          busy={busy}
          patchTeacher={patchTeacher}
          onClose={() => {
            setLessonFromSlot(null);
            setSelectedSlot(null);
          }}
          runAction={scheduleRunAction}
        />
      ) : null}

      {slotFormOpen && showTeacherSettings ? (
        <ScheduleSlotFormModal
          day={selectedDay}
          events={allEvents}
          daySlots={daySlots}
          busy={busy}
          patchTeacher={patchTeacher}
          onClose={() => setSlotFormOpen(false)}
          runAction={scheduleRunAction}
        />
      ) : null}

      {autoFillOpen && showTeacherSettings ? (
        <ScheduleAutoFillModal
          day={selectedDay}
          events={allEvents}
          daySlots={daySlots}
          busy={busy}
          patchTeacher={patchTeacher}
          onClose={() => setAutoFillOpen(false)}
          runAction={scheduleRunAction}
        />
      ) : null}
    </div>
  );
}
