'use client';

import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import {
  dateKey,
  eventsForDay,
  isSameDay,
  statusLabel,
} from '@/lib/teacher/schedule-utils';
import {
  WEEKDAYS_SHORT,
  getDayWorkState,
  weekdayIndex,
  workBandsLabel,
} from '@/lib/teacher/schedule-reference-utils';
import type { TeacherWorkingHoursData } from '@/lib/teacher/working-hours';
import { EventKindIcon, eventHeadline, eventPaidClass, eventSubline, eventTone } from './ScheduleWeekBoard';
import { IconPalmRef, IconPlusRef } from './ScheduleRefIcons';

type Props = {
  weekDays: Date[];
  day: Date;
  events: ScheduleEvent[];
  workingHours?: TeacherWorkingHoursData;
  selectedEventId: string | null;
  canCreate: boolean;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: ScheduleEvent) => void;
  onCreate: () => void;
};

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ScheduleDayAgenda({
  weekDays,
  day,
  events,
  workingHours,
  selectedEventId,
  canCreate,
  onSelectDay,
  onSelectEvent,
  onCreate,
}: Props) {
  const work = getDayWorkState(workingHours, day);
  const rows = eventsForDay(events, day).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="sr-agenda">
      <div className="sr-agenda-strip" role="tablist" aria-label="Дни недели">
        {weekDays.map((d) => {
          const count = eventsForDay(events, d).filter((e) => e.status !== 'cancelled').length;
          return (
            <button
              key={dateKey(d)}
              type="button"
              role="tab"
              aria-selected={isSameDay(d, day)}
              className={`sr-agenda-day${isSameDay(d, day) ? ' is-selected' : ''}`}
              onClick={() => onSelectDay(d)}
            >
              <span>{WEEKDAYS_SHORT[weekdayIndex(d)]}</span>
              <strong>{d.getDate()}</strong>
              <i className={count > 0 ? 'has-events' : ''} aria-hidden />
            </button>
          );
        })}
      </div>

      <div className="sr-agenda-work">
        {work.kind === 'work' ? (
          <>
            <span>Рабочее время</span>
            <strong>{workBandsLabel(work.bands)}</strong>
          </>
        ) : work.kind === 'off' ? (
          <>
            <IconPalmRef size={16} />
            <strong>{work.note?.trim() || 'Выходной'}</strong>
          </>
        ) : (
          <span>Рабочее время не задано</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="sr-empty">
          <p>На этот день занятий нет</p>
          {canCreate && work.kind !== 'off' ? (
            <button type="button" className="sr-btn sr-btn--primary" onClick={onCreate}>
              <IconPlusRef size={14} /> Добавить занятие
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="sr-agenda-list">
          {rows.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className={`sr-agenda-card sr-ev--tone-${eventTone(event)}${eventPaidClass(event)}${selectedEventId === event.id ? ' is-selected' : ''}`}
                onClick={() => onSelectEvent(event)}
              >
                <span className="sr-agenda-time">
                  {clock(event.startsAt)}
                  <small>{clock(event.endsAt)}</small>
                </span>
                <span className="sr-agenda-main">
                  <strong>{eventHeadline(event)}</strong>
                  <span>{eventSubline(event)}</span>
                </span>
                <span className="sr-agenda-meta">
                  <EventKindIcon kind={event.kind} size={16} />
                  {event.status !== 'scheduled' ? <small>{statusLabel(event.status)}</small> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

