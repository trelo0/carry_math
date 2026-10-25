'use client';

import type { ReactNode } from 'react';
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
  /** Развёрнутый день: под его неделей рисуется renderExpanded. */
  expandedDay: Date | null;
  onToggleDay: (day: Date) => void;
  renderExpanded: (day: Date) => ReactNode;
};

export default function ScheduleMonthGrid({
  month,
  events,
  selectedDay,
  nowMs,
  expandedDay,
  onToggleDay,
  renderExpanded,
}: Props) {
  const monthStart = startOfMonth(month);
  const days = getMonthGridDays(month);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
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
      <div className="sr-month-body">
        {weeks.map((week) => {
          const expandedInWeek = expandedDay ? week.find((d) => isSameDay(d, expandedDay)) : undefined;
          return (
            <div key={dateKey(week[0])} className="sr-month-week">
              <div className="sr-month-days">
                {week.map((day) => {
                  const inMonth = day.getMonth() === monthStart.getMonth();
                  const count = countEventsOnDay(events, day);
                  const isExpanded = expandedDay ? isSameDay(day, expandedDay) : false;
                  return (
                    <button
                      key={dateKey(day)}
                      type="button"
                      aria-expanded={isExpanded}
                      className={`sr-month-day${inMonth ? '' : ' is-outside'}${isSameDay(day, selectedDay) ? ' is-selected' : ''}${isExpanded ? ' is-expanded' : ''}${today && isSameDay(day, today) ? ' is-today' : ''}`}
                      onClick={() => onToggleDay(day)}
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
              {expandedInWeek ? (
                <div className="sr-month-expand">{renderExpanded(expandedInWeek)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      {visibleCount === 0 ? <p className="sr-month-empty">В этом месяце занятий нет</p> : null}
    </div>
  );
}
