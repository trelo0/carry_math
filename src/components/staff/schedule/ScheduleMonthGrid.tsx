'use client';

import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import {
  countEventsOnDay,
  dateKey,
  getMonthGridDays,
  isSameDay,
  startOfMonth,
} from '@/lib/teacher/schedule-utils';
import { WEEKDAYS_SHORT } from '@/lib/teacher/schedule-reference-utils';

type Props = {
  month: Date;
  events: ScheduleEvent[];
  selectedDay: Date;
  nowMs: number;
  onSelectDay: (day: Date) => void;
};

export default function ScheduleMonthGrid({ month, events, selectedDay, nowMs, onSelectDay }: Props) {
  const monthStart = startOfMonth(month);
  const days = getMonthGridDays(month);
  const today = nowMs > 0 ? new Date(nowMs) : null;
  const visibleCount = events.filter((event) => {
    const d = new Date(event.startsAt);
    return d.getFullYear() === monthStart.getFullYear() && d.getMonth() === monthStart.getMonth();
  }).length;

  return (
    <div className="sr-month">
      <div className="sr-month-weekdays">
        {WEEKDAYS_SHORT.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="sr-month-days">
        {days.map((day) => {
          const inMonth = day.getMonth() === monthStart.getMonth();
          const count = countEventsOnDay(events, day);
          return (
            <button
              key={dateKey(day)}
              type="button"
              className={`sr-month-day${inMonth ? '' : ' is-outside'}${isSameDay(day, selectedDay) ? ' is-selected' : ''}${today && isSameDay(day, today) ? ' is-today' : ''}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="sr-month-num">{day.getDate()}</span>
              {count > 0 ? (
                <span className="sr-month-count" aria-label={`Занятий: ${count}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {visibleCount === 0 ? <p className="sr-month-empty">В этом месяце занятий нет</p> : null}
    </div>
  );
}
