'use client';

import { useMemo } from 'react';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import {
  SCHEDULE_SLOT_HEIGHT,
  dateKey,
  dayGridTotalHeight,
  eventBlockLayout,
  eventsForDay,
  formatDayTitle,
  freeSlotsForDay,
  getDayGridHourRange,
  getHoursInRange,
  slotBlockLayout,
} from '@/lib/teacher/schedule-utils';
import ScheduleDaySlotBlock from './ScheduleDaySlotBlock';
import ScheduleEventBlock from './ScheduleEventBlock';

const WEEKDAY_UPPER = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];

export function dayHeadingUpper(date: Date): string {
  const idx = date.getDay() === 0 ? 6 : date.getDay() - 1;
  const monthDay = formatDayTitle(date).split(', ')[1] ?? '';
  return `${WEEKDAY_UPPER[idx]} · ${monthDay.toUpperCase()}`;
}

type Props = {
  day: Date;
  events: ScheduleEvent[];
  daySlots?: TeacherDaySlot[];
  selectedEventId?: string | null;
  selectedSlotId?: number | null;
  onSelectEvent: (event: ScheduleEvent) => void;
  onSelectFreeSlot?: (slot: TeacherDaySlot) => void;
};

export default function ScheduleDayGrid({
  day,
  events,
  daySlots = [],
  selectedEventId,
  selectedSlotId,
  onSelectEvent,
  onSelectFreeSlot,
}: Props) {
  const dayKeyStr = dateKey(day);
  const { hourStart, hourEndExclusive } = getDayGridHourRange(day, events, daySlots);
  const hours = getHoursInRange(hourStart, hourEndExclusive);
  const totalHeight = dayGridTotalHeight(hourStart, hourEndExclusive);
  const dayEvents = eventsForDay(events, day);

  const visibleFreeSlots = useMemo(
    () => freeSlotsForDay(daySlots, day, events),
    [daySlots, day, events],
  );

  const otherSlots = useMemo(
    () =>
      daySlots.filter(
        (s) =>
          s.slotDate === dayKeyStr &&
          s.slotKind !== 'extra' &&
          !visibleFreeSlots.some((f) => f.id === s.id),
      ),
    [daySlots, dayKeyStr, visibleFreeSlots],
  );

  return (
    <div className="schedule-grid schedule-grid--day sched-grid sched-day-grid">
      <div className="schedule-grid-body sched-grid-body">
        <div className="schedule-grid-times sched-grid-times" style={{ height: totalHeight }}>
          {hours.map((hour) => (
            <div key={hour} className="schedule-grid-hour" style={{ height: SCHEDULE_SLOT_HEIGHT }}>
              {hour}:00
            </div>
          ))}
        </div>

        <div className="schedule-grid-columns schedule-grid-columns--day">
          <div className="schedule-grid-column sched-grid-column is-highlight">
            <div className="schedule-grid-column-inner" style={{ height: totalHeight }}>
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="schedule-grid-cell sched-grid-cell"
                  style={{ height: SCHEDULE_SLOT_HEIGHT }}
                />
              ))}

              {otherSlots.map((slot) => {
                const layout = slotBlockLayout(slot.startTime, slot.endTime, hourStart);
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
                const layout = slotBlockLayout(slot.startTime, slot.endTime, hourStart);
                return (
                  <ScheduleDaySlotBlock
                    key={slot.id}
                    slot={slot}
                    top={layout.top}
                    height={layout.height}
                    isSelected={selectedSlotId === slot.id}
                    onClick={onSelectFreeSlot}
                  />
                );
              })}

              {dayEvents.map((event) => {
                const layout = eventBlockLayout(event.startsAt, event.endsAt, hourStart);
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
        </div>
      </div>
    </div>
  );
}
