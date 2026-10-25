'use client';

import type { TeacherCabinetData, TeacherRosterStudent } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { teacherLessonPaymentStatusLabel } from '@/lib/teacher/schedule-payment-labels';
import {
  eventsForDay,
  formatLessonDateTimeLine,
  isoToTimeLabel,
  statusLabel,
} from '@/lib/teacher/schedule-utils';
import {
  formatDayHeading,
  getDayWorkState,
  workBandsLabel,
  initialsOf,
  rosterLessonSummary,
  type WeekStats,
} from '@/lib/teacher/schedule-reference-utils';
import ScheduleWeekStats from './ScheduleWeekStats';
import { EventKindIcon, eventHeadline, eventSubline, eventTone } from './ScheduleWeekBoard';
import {
  IconCalendarRef,
  IconChevronLeftRef,
  IconPalmRef,
  IconPencilRef,
  IconSwapRef,
  IconUserPlusRef,
  IconXRef,
} from './ScheduleRefIcons';

type Props = {
  day: Date;
  nowMs: number;
  events: ScheduleEvent[];
  teacherData?: TeacherCabinetData;
  selectedEvent: ScheduleEvent | null;
  busy: boolean;
  onSelectEvent: (event: ScheduleEvent) => void;
  onBack: () => void;
  onEditDay?: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  onAddStudent?: () => void;
  onOpenStudent?: (student: TeacherRosterStudent) => void;
  onAddBlockSlot?: () => void;
  onRestoreArchived?: (student: TeacherRosterStudent) => void | Promise<void>;
  allEvents?: ScheduleEvent[];
  showCancelled?: boolean;
  onViewAllRoster?: () => void;
  stats: WeekStats;
};

const ROSTER_SIDEBAR_PREVIEW = 5;

function paymentLabel(event: ScheduleEvent): string | null {
  if (event.status === 'cancelled') return null;
  return teacherLessonPaymentStatusLabel(event.isPaid);
}

function seriesScheduledCount(events: ScheduleEvent[], seriesId: string | null | undefined): number {
  if (!seriesId) return 0;
  return events.filter((e) => e.seriesId === seriesId && e.status === 'scheduled').length;
}

export default function ScheduleRightPanel({
  day,
  nowMs,
  events,
  teacherData,
  selectedEvent,
  busy,
  onSelectEvent,
  onBack,
  onEditDay,
  onReschedule,
  onCancel,
  onAddStudent,
  onOpenStudent,
  onAddBlockSlot,
  onRestoreArchived,
  allEvents = [],
  showCancelled = false,
  onViewAllRoster,
  stats,
}: Props) {
  const work = getDayWorkState(teacherData?.workingHours, day);
  const roster = teacherData?.roster ?? [];
  const rosterPreview = roster.slice(0, ROSTER_SIDEBAR_PREVIEW);
  const dayEvents = eventsForDay(events, day)
    .filter((event) => showCancelled || event.status !== 'cancelled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const canAct = selectedEvent != null && selectedEvent.status === 'scheduled';
  const targetHint = selectedEvent
    ? canAct
      ? `${eventHeadline(selectedEvent)}, ${isoToTimeLabel(selectedEvent.startsAt)}`
      : 'Это занятие уже нельзя изменить'
    : 'Выберите занятие в календаре';
  const payment = selectedEvent ? paymentLabel(selectedEvent) : null;

  return (
    <aside className="sr-aside">
      <section className="sr-card">
        {selectedEvent ? (
          <>
            <div className="sr-card-row">
              <button type="button" className="sr-back" onClick={onBack}>
                <IconChevronLeftRef size={14} /> К дню
              </button>
              <span className={`sr-badge sr-badge--${eventTone(selectedEvent)}`}>
                {selectedEvent.status === 'cancelled'
                  ? 'Отменено'
                  : selectedEvent.status === 'scheduled'
                    ? 'Запланировано'
                    : statusLabel(selectedEvent.status)}
              </span>
            </div>
            <h2 className="sr-lesson-title">
              <EventKindIcon kind={selectedEvent.kind} size={16} />
              {eventHeadline(selectedEvent)}
            </h2>
            <dl className="sr-lesson-facts">
              <div>
                <dt>Время</dt>
                <dd>{formatLessonDateTimeLine(selectedEvent.startsAt, selectedEvent.endsAt)}</dd>
              </div>
              <div>
                <dt>{selectedEvent.kind === 'group' ? 'Группа' : 'Ученик'}</dt>
                <dd>{selectedEvent.participantLabel}</dd>
              </div>
              {selectedEvent.sourceLesson?.lessonPlan?.trim() ? (
                <div>
                  <dt>Комментарий</dt>
                  <dd>{selectedEvent.sourceLesson.lessonPlan.trim()}</dd>
                </div>
              ) : null}
              {payment ? (
                <div>
                  <dt>Оплата</dt>
                  <dd>{payment}</dd>
                </div>
              ) : null}
              {selectedEvent.seriesId ? (
                <div>
                  <dt>Серия</dt>
                  <dd>
                    {seriesScheduledCount(allEvents, selectedEvent.seriesId)} запланированных в этой серии
                  </dd>
                </div>
              ) : null}
              {selectedEvent.status === 'cancelled' && selectedEvent.cancelReason ? (
                <div>
                  <dt>Причина</dt>
                  <dd>{selectedEvent.cancelReason}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <>
            <h2 className="sr-card-title">
              <IconCalendarRef size={16} />
              {formatDayHeading(day, nowMs)}
            </h2>

            <div className="sr-today-work">
              {work.kind === 'work' ? (
                <div className="sr-today-work-text">
                  <strong>{work.custom ? 'Особое время' : 'Рабочее время'}</strong>
                  <span>{workBandsLabel(work.bands)}</span>
                </div>
              ) : work.kind === 'off' ? (
                <div className="sr-today-work-text">
                  <strong>
                    <IconPalmRef size={14} /> {work.note?.trim() || 'Выходной'}
                  </strong>
                  <span>Нерабочий день</span>
                </div>
              ) : (
                <div className="sr-today-work-text">
                  <strong>Рабочее время</strong>
                  <span>Не задано</span>
                </div>
              )}
              {onEditDay ? (
                <button
                  type="button"
                  className="sr-icon-btn"
                  onClick={onEditDay}
                  aria-label="Рабочее время на этот день"
                  title="Рабочее время на этот день"
                >
                  <IconPencilRef size={14} />
                </button>
              ) : null}
            </div>

            <h3 className="sr-card-sub">Занятия ({dayEvents.length})</h3>
            {dayEvents.length === 0 ? (
              <p className="sr-muted">На этот день занятий нет</p>
            ) : (
              <ul className="sr-day-list">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <button type="button" className="sr-day-item" onClick={() => onSelectEvent(event)}>
                      <span className={`sr-dot sr-dot--${eventTone(event)}`} aria-hidden />
                      <span className="sr-day-time">{isoToTimeLabel(event.startsAt)}</span>
                      <span className="sr-day-kind">
                        <EventKindIcon kind={event.kind} size={14} />
                      </span>
                      <span className="sr-day-text">
                        <strong>{eventHeadline(event)}</strong>
                        <span>{eventSubline(event)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="sr-card">
        <h2 className="sr-card-title sr-card-title--plain">Быстрые действия</h2>
        <ul className="sr-quick-list" title={targetHint}>
          <li>
            <button
              type="button"
              className="sr-quick"
              disabled={!canAct || busy}
              onClick={onReschedule}
            >
              <span className="sr-quick-ico">
                <IconSwapRef size={16} />
              </span>
              Перенести занятие
            </button>
          </li>
          <li>
            <button
              type="button"
              className="sr-quick"
              disabled={!canAct || busy}
              onClick={onCancel}
            >
              <span className="sr-quick-ico">
                <IconXRef size={16} />
              </span>
              Отменить занятие
            </button>
          </li>
        </ul>
        <p className="sr-muted sr-quick-hint">{targetHint}</p>
        {onAddBlockSlot && !selectedEvent ? (
          <button type="button" className="sr-btn sr-btn--ghost sr-btn--block" onClick={onAddBlockSlot}>
            Перерыв или блокировка времени
          </button>
        ) : null}
      </section>

      <section className="sr-card">
        <div className="sr-card-row">
          <h2 className="sr-card-title sr-card-title--plain">Мои ученики ({roster.length})</h2>
          {onAddStudent ? (
            <button type="button" className="sr-icon-btn" onClick={onAddStudent} aria-label="Добавить ученика" title="Добавить ученика">
              <IconUserPlusRef size={14} />
            </button>
          ) : null}
        </div>
        {roster.length === 0 ? (
          <p className="sr-muted">Добавьте учеников, чтобы выбирать их в расписании</p>
        ) : (
          <>
            <ul className="sr-student-list">
              {rosterPreview.map((student) => {
                const info = rosterLessonSummary(teacherData?.allLessons ?? [], student.id, nowMs);
                return (
                  <li key={student.id}>
                    <button type="button" className="sr-student" onClick={() => onOpenStudent?.(student)}>
                      <span className={`sr-avatar sr-avatar--${student.id % 4}`}>{initialsOf(student.name)}</span>
                      <span className="sr-student-text">
                        <strong>{student.name}</strong>
                        <span>
                          {[student.classLabel ? `${student.classLabel} кл.` : null, info.slots || 'нет занятий']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {onViewAllRoster && roster.length > 0 ? (
              <button type="button" className="sr-link sr-roster-all" onClick={onViewAllRoster}>
                {roster.length > ROSTER_SIDEBAR_PREVIEW
                  ? `Показать всех (${roster.length})`
                  : 'Открыть список учеников'}
              </button>
            ) : null}
          </>
        )}
      </section>

      {(teacherData?.archivedRoster?.length ?? 0) > 0 ? (
        <section className="sr-card">
          <h2 className="sr-card-title sr-card-title--plain">
            Архив ({teacherData?.archivedRoster?.length ?? 0})
          </h2>
          <ul className="sr-student-list sr-student-list--compact">
            {(teacherData?.archivedRoster ?? []).map((student) => (
              <li key={student.id}>
                <span className="sr-student-text">
                  <strong>{student.name}</strong>
                </span>
                {onRestoreArchived ? (
                  <button type="button" className="sr-btn sr-btn--ghost sr-btn--sm" onClick={() => void onRestoreArchived(student)}>
                    Восстановить
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ScheduleWeekStats stats={stats} />
    </aside>
  );
}



