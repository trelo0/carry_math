'use client';

import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import {
  SCHEDULE_HOUR_START,
  SCHEDULE_SLOT_HEIGHT,
  dateKey,
  eventBlockLayout,
  eventsForDay,
  formatWeekRange,
  freeSlotsForDay,
  getScheduleHours,
  gridTotalHeight,
  isSameDay,
  isToday,
  slotBlockLayout,
} from '@/lib/teacher/schedule-utils';
import ScheduleDaySlotBlock from './ScheduleDaySlotBlock';
import ScheduleEventBlock from './ScheduleEventBlock';

type Props = {
  days: Date[];
  events: ScheduleEvent[];
  daySlots?: TeacherDaySlot[];
  selectedDay: Date;
  selectedEventId?: string | null;
  selectedSlotId?: number | null;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: ScheduleEvent) => void;
  onSelectFreeSlot?: (slot: TeacherDaySlot) => void;
};

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function ScheduleGrid({
  days,
  events,
  daySlots = [],
  selectedDay,
  selectedEventId,
  selectedSlotId,
  onSelectDay,
  onSelectEvent,
  onSelectFreeSlot,
}: Props) {
  const hours = getScheduleHours();
  const totalHeight = gridTotalHeight();
  const weekLabel = days.length >= 7 ? formatWeekRange(days[0]) : '';

  return (
    <div className="sched-week-card">
      <header className="sched-week-card-head">
        <h2>Неделя · {weekLabel}</h2>
      </header>

      <div className="schedule-grid schedule-grid--week sched-grid">
        <div className="schedule-grid-head sched-grid-head">
          <div className="schedule-grid-corner" />
          {days.map((day) => {
            const highlighted = isSameDay(day, selectedDay);
            return (
              <button
                key={day.toISOString()}
                type="button"
                className={`schedule-grid-day-head sched-grid-day-head${highlighted ? ' is-highlight' : ''}${isToday(day) ? ' is-today' : ''}`}
                onClick={() => onSelectDay(day)}
              >
                <span className="schedule-grid-wd">{WEEKDAY_SHORT[day.getDay() === 0 ? 6 : day.getDay() - 1]}</span>
                <strong>{day.getDate()}</strong>
              </button>
            );
          })}
        </div>

        <div className="schedule-grid-body sched-grid-body">
          <div className="schedule-grid-times sched-grid-times" style={{ height: totalHeight }}>
            {hours.map((hour) => (
              <div key={hour} className="schedule-grid-hour" style={{ height: SCHEDULE_SLOT_HEIGHT }}>
                {hour}:00
              </div>
            ))}
          </div>

          <div className="schedule-grid-columns schedule-grid-columns--week">
            {days.map((day) => {
              const dayKeyStr = dateKey(day);
              const dayEvents = eventsForDay(events, day);
              const visibleFreeSlots = freeSlotsForDay(daySlots, day, events);
              const otherSlots = daySlots.filter(
                (s) =>
                  s.slotDate === dayKeyStr &&
                  s.slotKind !== 'extra' &&
                  !visibleFreeSlots.some((f) => f.id === s.id),
              );
              const highlighted = isSameDay(day, selectedDay);
              return (
                <div
                  key={day.toISOString()}
                  role="button"
                  tabIndex={0}
                  className={`schedule-grid-column sched-grid-column${highlighted ? ' is-highlight' : ''}`}
                  onClick={() => onSelectDay(day)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelectDay(day);
                  }}
                >
                  <div className="schedule-grid-column-inner" style={{ height: totalHeight }}>
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="schedule-grid-cell sched-grid-cell"
                        style={{ height: SCHEDULE_SLOT_HEIGHT }}
                      />
                    ))}

                    {otherSlots.map((slot) => {
                      const layout = slotBlockLayout(slot.startTime, slot.endTime, SCHEDULE_HOUR_START);
                      return (
                        <ScheduleDaySlotBlock
                          key={slot.id}
                          slot={slot}
                          top={layout.top}
                          height={layout.height}
                        />
                      );
                    })}

                    {visibleFreeSlots.map((slot) => {
                      const layout = slotBlockLayout(slot.startTime, slot.endTime, SCHEDULE_HOUR_START);
                      return (
                        <ScheduleDaySlotBlock
                          key={slot.id}
                          slot={slot}
                          top={layout.top}
                          height={layout.height}
                          isSelected={selectedSlotId === slot.id}
                          onClick={(picked) => {
                            onSelectDay(day);
                            onSelectFreeSlot?.(picked);
                          }}
                        />
                      );
                    })}

                    {dayEvents.map((event) => {
                      const layout = eventBlockLayout(event.startsAt, event.endsAt);
                      return (
                        <ScheduleEventBlock
                          key={event.id}
                          event={event}
                          isSelected={selectedEventId === event.id}
                          top={layout.top}
                          height={layout.height}
                          onClick={() => onSelectEvent(event)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
