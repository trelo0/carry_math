'use client';

import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { eventsForDay, isSameDay, isToday } from '@/lib/teacher/schedule-utils';

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type Props = {
  days: Date[];
  selectedDay: Date;
  events: ScheduleEvent[];
  onSelectDay: (day: Date) => void;
};

export default function ScheduleWeekStrip({ days, selectedDay, events, onSelectDay }: Props) {
  return (
    <div className="sched-week-strip" role="tablist" aria-label="Дни недели">
      {days.map((day) => {
        const dayEvents = eventsForDay(events, day);
        const selected = isSameDay(day, selectedDay);
        const today = isToday(day);
        const wd = WEEKDAY_SHORT[day.getDay() === 0 ? 6 : day.getDay() - 1];
        return (
          <button
            key={day.toISOString()}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`sched-week-day${selected ? ' is-selected' : ''}${today ? ' is-today' : ''}`}
            onClick={() => onSelectDay(day)}
          >
            <span className="sched-week-day-wd">{wd}</span>
            <strong className="sched-week-day-num">{day.getDate()}</strong>
            <span className="sched-week-day-dots" aria-hidden={dayEvents.length === 0}>
              {dayEvents.slice(0, 3).map((ev) => (
                <span key={ev.id} className={`sched-week-dot sched-week-dot--${ev.kind}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
