'use client';

import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { kindBadgeLabel } from '@/lib/teacher/schedule-utils';

type Props = {
  event: ScheduleEvent;
  isSelected?: boolean;
  top: number;
  height: number;
  onClick: () => void;
};

export default function ScheduleEventBlock({ event, isSelected, top, height, onClick }: Props) {
  const startTime = new Date(event.startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <button
      type="button"
      className={`sched-grid-event sched-grid-event--${event.kind} sched-grid-event--${event.status}${isSelected ? ' is-selected' : ''}`}
      style={{ top: `${top}px`, height: `${Math.max(height, 28)}px` }}
      onClick={onClick}
    >
      <span className="sched-grid-event-accent" aria-hidden />
      <span className="sched-grid-event-kind">{kindBadgeLabel(event.kind)}</span>
      <span className="sched-grid-event-time">{startTime}</span>
    </button>
  );
}
