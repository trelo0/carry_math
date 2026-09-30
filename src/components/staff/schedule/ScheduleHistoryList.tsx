'use client';

import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { formatLessonDateTimeLine, kindBadgeLabel, statusLabel } from '@/lib/teacher/schedule-utils';

type Props = {
  events: ScheduleEvent[];
  selectedEventId: string | null;
  onSelectEvent: (event: ScheduleEvent) => void;
};

export default function ScheduleHistoryList({ events, selectedEventId, onSelectEvent }: Props) {
  const sorted = [...events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  if (sorted.length === 0) {
    return <p className="sched-aside-muted sched-history-empty">Прошлых занятий пока нет.</p>;
  }

  return (
    <ul className="sched-history-list">
      {sorted.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className={`sched-history-item${selectedEventId === event.id ? ' is-selected' : ''}`}
            onClick={() => onSelectEvent(event)}
          >
            <span className="sched-history-item-top">
              <span className={`sched-grid-event-kind sched-history-status--${event.status}`}>
                {statusLabel(event.status)}
              </span>
              <span className="sched-history-kind">{kindBadgeLabel(event.kind)}</span>
            </span>
            <span className="sched-history-title">{event.title}</span>
            {event.participantLabel ? (
              <span className="sched-history-participant">{event.participantLabel}</span>
            ) : null}
            <span className="sched-history-when">{formatLessonDateTimeLine(event.startsAt, event.endsAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
