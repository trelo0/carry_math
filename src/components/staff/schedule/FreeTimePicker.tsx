'use client';

import { useMemo } from 'react';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { minutesToTime, timeToMinutes } from '@/lib/teacher/schedule-utils';
import { computeDayAvailability } from '@/lib/teacher/schedule-reference-utils';
import type { TeacherWorkingHoursData } from '@/lib/teacher/working-hours';

type Props = {
  day: Date;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours?: TeacherWorkingHoursData;
  excludeLessonId?: number;
  durationMinutes: number;
  startTime: string;
  onPick: (startTime: string) => void;
};

const range = (a: number, b: number) => `${minutesToTime(a)}–${minutesToTime(b)}`;

/** Занятое и свободное время выбранного дня: выбор слота кликом вместо ручного ввода. */
export default function FreeTimePicker({
  day,
  events,
  daySlots,
  workingHours,
  excludeLessonId,
  durationMinutes,
  startTime,
  onPick,
}: Props) {
  const availability = useMemo(
    () => computeDayAvailability({ day, events, daySlots, workingHours, excludeLessonId }),
    [day, events, daySlots, workingHours, excludeLessonId],
  );

  if (availability.kind === 'off') {
    return <p className="sr-modal-hint">В этот день выходной — выберите другой день.</p>;
  }

  const from = Math.min(...availability.bands.map((b) => b.start));
  const to = Math.max(...availability.bands.map((b) => b.end));
  const total = Math.max(to - from, 1);
  const pct = (minutes: number) => `${(((minutes - from) / total) * 100).toFixed(2)}%`;
  const startMin = startTime ? timeToMinutes(startTime) : null;

  return (
    <div className="sr-avail">
      <div className="sr-avail-bar" aria-hidden>
        {availability.free.map((slot) => (
          <span
            key={`f-${slot.start}`}
            className="sr-avail-seg sr-avail-seg--free"
            style={{ left: pct(slot.start), width: `${(((slot.end - slot.start) / total) * 100).toFixed(2)}%` }}
          />
        ))}
        {availability.busy.map((slot, index) => (
          <span
            key={`b-${slot.start}-${index}`}
            className="sr-avail-seg sr-avail-seg--busy"
            style={{
              left: pct(Math.max(slot.start, from)),
              width: `${((Math.min(slot.end, to) - Math.max(slot.start, from)) / total) * 100}%`,
            }}
          />
        ))}
        {startMin != null && startMin >= from && startMin <= to ? (
          <span className="sr-avail-mark" style={{ left: pct(startMin) }} />
        ) : null}
      </div>
      <div className="sr-avail-scale">
        <span>{minutesToTime(from)}</span>
        <span>{minutesToTime(to)}</span>
      </div>

      {availability.busy.length > 0 ? (
        <div className="sr-avail-group">
          <span className="sr-avail-title">Занято</span>
          <div className="sr-avail-chips">
            {availability.busy.map((slot, index) => (
              <span key={`bc-${slot.start}-${index}`} className="sr-avail-chip sr-avail-chip--busy">
                {range(slot.start, slot.end)} · {slot.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="sr-avail-group">
        <span className="sr-avail-title">
          {availability.free.length > 0 ? 'Свободно — нажмите, чтобы выбрать' : 'Свободного времени нет'}
        </span>
        <div className="sr-avail-chips">
          {availability.free.map((slot) => {
            const fits = slot.end - slot.start >= durationMinutes;
            const active = startMin != null && startMin >= slot.start && startMin < slot.end;
            return (
              <button
                key={`fc-${slot.start}`}
                type="button"
                disabled={!fits}
                title={fits ? undefined : `Нужно ${durationMinutes} мин`}
                className={`sr-avail-chip sr-avail-chip--free${active ? ' is-active' : ''}`}
                onClick={() => onPick(minutesToTime(slot.start))}
              >
                {range(slot.start, slot.end)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

