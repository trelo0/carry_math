'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import { getScheduleFilters, isScheduleFilterValid } from '@/lib/teacher/schedule-config';
import type { ScheduleEvent, ScheduleFilter, ScheduleViewMode } from '@/lib/teacher/schedule-types';
import {
  addDays,
  dateKey,
  filterScheduleEvents,
  getWeekDays,
  isSameDay,
  mapTeacherLessonToEvent,
  startOfWeek,
} from '@/lib/teacher/schedule-utils';
import {
  computeOrdinaryWeekStats,
  formatPeriodLabel,
} from '@/lib/teacher/schedule-reference-utils';
import ScheduleAddModal from './ScheduleAddModal';
import ScheduleDayAgenda from './ScheduleDayAgenda';
import ScheduleDayHoursModal from './ScheduleDayHoursModal';
import ScheduleDayTimeline from './ScheduleDayTimeline';
import {
  ScheduleCancelModal,
  ScheduleCompleteModal,
  ScheduleRescheduleModal,
} from './ScheduleLessonActionModals';
import ScheduleMonthGrid from './ScheduleMonthGrid';
import ScheduleRightPanel from './ScheduleRightPanel';
import { RosterScheduleModal, RosterStudentModal } from './ScheduleRosterModals';
import ScheduleTopbar from './ScheduleTopbar';
import ScheduleWeekBoard from './ScheduleWeekBoard';
import ScheduleWorkingHoursModal from './ScheduleWorkingHoursModal';
import ScheduleToastStack from './ScheduleToastStack';
import { IconClockRef, IconPlusRef } from './ScheduleRefIcons';
import { scheduleSizeFor, useElementWidth, useIsMobile, useNowMs } from './schedule-hooks';

type Props = {
  teacherData?: TeacherCabinetData;
  onLessonFinished?: (lessonId: number) => void;
  focusLessonId?: number | null;
  onFocusLessonHandled?: () => void;
  /** Админ видит отменённые занятия полупрозрачными карточками; преподаватель — нет. */
  showCancelled?: boolean;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  busy: boolean;
  runAction: StaffRunAction;
};

type AddDraft = {
  date: Date;
  startTime?: string;
  endTime?: string;
  kind: 'individual' | 'group';
};

type RosterModal = { type: 'new' } | { type: 'edit' | 'schedule'; id: number };

type LessonModal = { type: 'reschedule' | 'cancel' | 'complete'; eventId: string };

const SCHEDULE_VIEW_STORAGE_KEY = 'district-teacher-schedule-view';

function readStoredViewMode(): ScheduleViewMode {
  if (typeof window === 'undefined') return 'week';
  const stored = window.localStorage.getItem(SCHEDULE_VIEW_STORAGE_KEY);
  if (stored === 'day' || stored === 'week' || stored === 'month') return stored;
  return 'week';
}

function shiftMonth(date: Date, delta: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(date.getDate(), lastDay));
  return first;
}

export default function TeacherSchedulePanel({
  teacherData,
  onLessonFinished,
  focusLessonId,
  onFocusLessonHandled,
  showCancelled = false,
  patchTeacher,
  busy,
  runAction,
}: Props) {  const filters = useMemo(() => getScheduleFilters(), []);
  const isMobile = useIsMobile();
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const size = rootWidth > 0 ? scheduleSizeFor(rootWidth) : 'wide';
  const compactPanel = size !== 'wide';
  const nowMs = useNowMs();

  const [viewMode, setViewMode] = useState<ScheduleViewMode>(() => readStoredViewMode());
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft | null>(null);
  const [lessonModal, setLessonModal] = useState<LessonModal | null>(null);
  const [rosterModal, setRosterModal] = useState<RosterModal | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [dayHours, setDayHours] = useState<{ day: Date; mode?: 'work' | 'off'; note?: string } | null>(null);
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  const [notice, setNotice] = useState<ActionFeedback | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SCHEDULE_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const effectiveView: ScheduleViewMode = isMobile && viewMode === 'week' ? 'day' : viewMode;
  const activeFilter = isScheduleFilterValid(filter) ? filter : 'all';
  const canCreate = Boolean(teacherData);

  const weekStart = useMemo(() => startOfWeek(selectedDay), [selectedDay]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const daySlots = useMemo(() => teacherData?.daySlots ?? [], [teacherData?.daySlots]);

  const allEvents = useMemo(
    () =>
      (teacherData?.allLessons ?? [])
        .map(mapTeacherLessonToEvent)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [teacherData?.allLessons],
  );

  // Отменённые занятия скрыты у преподавателя; админ видит их полупрозрачными.
  const calendarEvents = useMemo(
    () =>
      filterScheduleEvents(allEvents, activeFilter).filter(
        (event) => event.kind !== 'course' && (showCancelled || event.status !== 'cancelled'),
      ),
    [allEvents, activeFilter, showCancelled],
  );

  // Фокус на занятии из другого раздела (применяется один раз при смене focusLessonId).
  if (focusLessonId != null && focusLessonId !== handledFocus) {
    setHandledFocus(focusLessonId);
    const match = allEvents.find((event) => event.lessonId === focusLessonId);
    if (match) {
      setSelectedDay(new Date(match.startsAt));
      setSelectedEventId(match.id);
    }
  }
  useEffect(() => {
    if (focusLessonId != null) onFocusLessonHandled?.();
  }, [focusLessonId, onFocusLessonHandled]);

  const selectedEvent = useMemo(
    () => calendarEvents.find((event) => event.id === selectedEventId) ?? null,
    [calendarEvents, selectedEventId],
  );
  const modalEvent = useMemo(
    () => (lessonModal ? (allEvents.find((event) => event.id === lessonModal.eventId) ?? null) : null),
    [allEvents, lessonModal],
  );

  const weekStats = useMemo(() => computeOrdinaryWeekStats(allEvents, weekStart), [allEvents, weekStart]);

  const today = nowMs > 0 ? new Date(nowMs) : null;
  const showToday = today
    ? effectiveView === 'week'
      ? !weekDays.some((d) => isSameDay(d, today))
      : effectiveView === 'month'
        ? today.getFullYear() !== selectedDay.getFullYear() || today.getMonth() !== selectedDay.getMonth()
        : !isSameDay(today, selectedDay)
    : false;

  const weekHasEvents = calendarEvents.some((event) => {
    const d = new Date(event.startsAt);
    return dateKey(startOfWeek(d)) === dateKey(weekStart);
  });
  const hoursUnset = Boolean(teacherData) && (teacherData?.workingHours.weekly.length ?? 0) === 0;

  const scheduleRunAction: StaffRunAction = useCallback(
    (action, successText, options) =>
      runAction(action, successText, {
        refresh: options?.refresh ?? 'none',
        awaitRefresh: false,
        silent: true,
        ...options,
      }),
    [runAction],
  );

  const openEvent = (event: ScheduleEvent) => {
    setSelectedEventId(event.id);
    setSelectedDay(new Date(event.startsAt));
    if (compactPanel) setDrawerOpen(true);
  };

  // Смена дня сбрасывает открытое занятие: в сайдбаре снова список дня.
  const pickDay = (day: Date) => {
    setSelectedDay(day);
    setSelectedEventId(null);
  };

  // Месяц: клик по дню раскрывает горизонтальное расписание под неделей, повторный клик — сворачивает.
  const toggleMonthDay = (day: Date) => {
    pickDay(day);
    setExpandedDay((prev) => (prev && isSameDay(prev, day) ? null : day));
  };

  const shift = (delta: number) => {
    setSelectedEventId(null);
    setExpandedDay(null);
    setSelectedDay((prev) =>
      effectiveView === 'month'
        ? shiftMonth(prev, delta)
        : addDays(prev, effectiveView === 'week' ? delta * 7 : delta),
    );
  };

  const openAdd = (draft: AddDraft | null) => {
    setAddDraft(draft);
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddDraft(null);
  };

  const openLessonModal = (type: LessonModal['type']) => {
    if (selectedEvent) setLessonModal({ type, eventId: selectedEvent.id });
  };

  return (
    <div ref={rootRef} className="sr-root sched-page" data-size={size} data-panel={drawerOpen ? 'open' : 'closed'}>
      <ScheduleTopbar
        viewMode={effectiveView}
        isMobile={isMobile}
        periodLabel={formatPeriodLabel(effectiveView, selectedDay, weekStart)}
        showToday={showToday}
        nowMs={nowMs}
        panelOpen={drawerOpen}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
        onToday={() => pickDay(new Date())}
        onChangeView={(mode) => {
          setViewMode(mode);
          setExpandedDay(null);
        }}
        onTogglePanel={() => setDrawerOpen((prev) => !prev)}
      />

      <div className="sr-filters-row">
        <div className="sr-filters" role="tablist" aria-label="Фильтры занятий">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeFilter === item.id}
              className={`sr-filter${activeFilter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="sr-actions">
          {canCreate ? (
            <button type="button" className="sr-btn sr-btn--ghost" onClick={() => setHoursOpen(true)}>
              <IconClockRef size={15} /> Рабочее время
            </button>
          ) : null}
          {canCreate ? (
            <button type="button" className="sr-btn sr-btn--primary" onClick={() => openAdd(null)}>
              <IconPlusRef size={15} /> Добавить занятие
            </button>
          ) : null}
        </div>
      </div>

      <div className="sr-board-area">
        {hoursUnset || (effectiveView === 'week' && !weekHasEvents) ? (
          <div className="sr-notices">
            {hoursUnset ? (
              <p>
                Рабочее время не задано.{' '}
                {canCreate ? (
                  <button type="button" className="sr-link" onClick={() => setHoursOpen(true)}>
                    Настроить
                  </button>
                ) : null}
              </p>
            ) : null}
            {effectiveView === 'week' && !weekHasEvents ? <p>На этой неделе занятий пока нет</p> : null}
          </div>
        ) : null}

        {effectiveView === 'month' ? (
          <ScheduleMonthGrid
            month={selectedDay}
            events={calendarEvents}
            selectedDay={selectedDay}
            nowMs={nowMs}
            expandedDay={expandedDay}
            onToggleDay={toggleMonthDay}
            renderExpanded={(day) => (
              <ScheduleDayTimeline
                day={day}
                events={calendarEvents}
                daySlots={daySlots}
                workingHours={teacherData?.workingHours}
                selectedEventId={selectedEventId}
                nowMs={nowMs}
                canCreate={canCreate}
                showHeading
                onSelectEvent={openEvent}
                onCreateAt={(d, startTime, endTime) =>
                  openAdd({ date: d, startTime, endTime, kind: 'individual' })
                }
              />
            )}
          />
        ) : isMobile ? (
          <ScheduleDayAgenda
            weekDays={weekDays}
            day={selectedDay}
            events={calendarEvents}
            workingHours={teacherData?.workingHours}
            selectedEventId={selectedEventId}
            canCreate={canCreate}
            onSelectDay={pickDay}
            onSelectEvent={openEvent}
            onCreate={() => openAdd({ date: selectedDay, kind: 'individual' })}
          />
        ) : effectiveView === 'day' ? (
          <div className="sr-board sr-board--single sr-dt-board">
            <ScheduleDayTimeline
              day={selectedDay}
              events={calendarEvents}
              daySlots={daySlots}
              workingHours={teacherData?.workingHours}
              selectedEventId={selectedEventId}
              nowMs={nowMs}
              canCreate={canCreate}
              onSelectEvent={openEvent}
              onCreateAt={(day, startTime, endTime) =>
                openAdd({ date: day, startTime, endTime, kind: 'individual' })
              }
            />
          </div>
        ) : (
          <ScheduleWeekBoard
            days={weekDays}
            events={calendarEvents}
            daySlots={daySlots}
            workingHours={teacherData?.workingHours}
            selectedDay={selectedDay}
            selectedEventId={selectedEventId}
            nowMs={nowMs}
            canCreate={canCreate}
            onSelectDay={pickDay}
            onSelectEvent={openEvent}
            onCreateAt={(day, startTime, endTime) =>
              openAdd({ date: day, startTime, endTime, kind: 'individual' })
            }
          />
        )}
      </div>

      {(() => {
        const rightPanel = (
          <ScheduleRightPanel
            day={selectedDay}
            nowMs={nowMs}
            events={calendarEvents}
            teacherData={teacherData}
            selectedEvent={selectedEvent}
            busy={busy}
            onSelectEvent={openEvent}
            onBack={() => setSelectedEventId(null)}
            onEditDay={canCreate ? () => setDayHours({ day: selectedDay }) : undefined}
            onReschedule={() => openLessonModal('reschedule')}
            onComplete={() => openLessonModal('complete')}
            onCancel={() => openLessonModal('cancel')}
            onAddLesson={canCreate ? () => openAdd({ date: selectedDay, kind: 'individual' }) : undefined}
            onAddStudent={canCreate ? () => setRosterModal({ type: 'new' }) : undefined}
            onOpenStudent={(student) => setRosterModal({ type: 'edit', id: student.id })}
            stats={weekStats}
          />
        );

        if (compactPanel) {
          return drawerOpen ? (
            <div className="sr-drawer-layer" role="dialog" aria-modal="true" aria-label="Панель дня">
              <button
                type="button"
                className="sr-drawer-backdrop"
                onClick={() => setDrawerOpen(false)}
                aria-label="Закрыть панель"
              />
              <div className="sr-drawer sr-drawer--schedule">{rightPanel}</div>
            </div>
          ) : null;
        }

        return rightPanel;
      })()}

      {lessonModal && modalEvent && teacherData ? (
        lessonModal.type === 'reschedule' ? (
          <ScheduleRescheduleModal
            event={modalEvent}
            events={allEvents}
            daySlots={daySlots}
            workingHours={teacherData.workingHours}
            busy={busy}
            runAction={scheduleRunAction}
            report={setNotice}
            patchTeacher={patchTeacher}
            onClose={() => setLessonModal(null)}
          />
        ) : lessonModal.type === 'cancel' ? (
          <ScheduleCancelModal
            event={modalEvent}
            busy={busy}
            runAction={scheduleRunAction}
            report={setNotice}
            patchTeacher={patchTeacher}
            onFinished={onLessonFinished}
            onClose={() => setLessonModal(null)}
          />
        ) : (
          <ScheduleCompleteModal
            event={modalEvent}
            busy={busy}
            runAction={scheduleRunAction}
            report={setNotice}
            patchTeacher={patchTeacher}
            onFinished={onLessonFinished}
            onClose={() => setLessonModal(null)}
          />
        )
      ) : null}

      {addOpen && teacherData ? (
        <ScheduleAddModal
          key={
            addDraft
              ? `draft-${dateKey(addDraft.date)}-${addDraft.startTime ?? ''}-${addDraft.endTime ?? ''}`
              : 'add'
          }
          data={teacherData}
          events={allEvents}
          daySlots={daySlots}
          initialDate={addDraft?.date ?? selectedDay}
          initialKind={addDraft?.kind ?? 'individual'}
          initialStartTime={addDraft?.startTime}
          initialEndTime={addDraft?.endTime}
          busy={busy}
          report={setNotice}
          patchTeacher={patchTeacher}
          onClose={closeAdd}
          runAction={scheduleRunAction}
        />
      ) : null}

      {rosterModal && teacherData
        ? (() => {
            const target =
              rosterModal.type === 'new'
                ? undefined
                : teacherData.roster.find((student) => student.id === rosterModal.id);
            if (rosterModal.type !== 'new' && !target) return null;
            if (rosterModal.type === 'schedule' && target) {
              return (
                <RosterScheduleModal
                  student={target}
                  data={teacherData}
                  events={allEvents}
                  busy={busy}
                  runAction={scheduleRunAction}
                  report={setNotice}
                  patchTeacher={patchTeacher}
                  onClose={() => setRosterModal(null)}
                />
              );
            }
            return (
              <RosterStudentModal
                key={target?.id ?? 'new'}
                student={target}
                data={teacherData}
                nowMs={nowMs}
                busy={busy}
                runAction={scheduleRunAction}
                report={setNotice}
                patchTeacher={patchTeacher}
                onSchedule={(student) => setRosterModal({ type: 'schedule', id: student.id })}
                onClose={() => setRosterModal(null)}
              />
            );
          })()
        : null}

      {hoursOpen && teacherData ? (
        <ScheduleWorkingHoursModal
          workingHours={teacherData.workingHours}
          events={calendarEvents}
          busy={busy}
          runAction={scheduleRunAction}
          report={setNotice}
          patchTeacher={patchTeacher}
          onAddOffDay={(date, note) => {
            const [y, m, d] = date.split('-').map(Number);
            setHoursOpen(false);
            setDayHours({ day: new Date(y, m - 1, d), mode: 'off', note });
          }}
          onClose={() => setHoursOpen(false)}
        />
      ) : null}

      {dayHours && teacherData ? (
        <ScheduleDayHoursModal
          key={dateKey(dayHours.day)}
          day={dayHours.day}
          initialMode={dayHours.mode}
          initialNote={dayHours.note}
          workingHours={teacherData.workingHours}
          events={allEvents}
          busy={busy}
          runAction={scheduleRunAction}
          report={setNotice}
          patchTeacher={patchTeacher}
          onClose={() => setDayHours(null)}
        />
      ) : null}

      <ScheduleToastStack feedback={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}






