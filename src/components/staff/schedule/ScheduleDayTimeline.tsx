'use client';

import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import {
  dateKey,
  eventsForDay,
  isSameDay,
  minutesToTime,
  slotOverlapsLesson,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import {
  computeHourRange,
  formatDayHeading,
  getDayWorkState,
  isInsideBands,
  layoutDayEvents,
  nonWorkingSegments,
  snapMinutes,
  workBandsLabel,
} from '@/lib/teacher/schedule-reference-utils';
import type { TeacherWorkingHoursData } from '@/lib/teacher/working-hours';
import { IconPalmRef } from './ScheduleRefIcons';
import {
  EventKindIcon,
  SR_DEFAULT_DURATION,
  eventHeadline,
  eventPaymentLabel,
  eventSubline,
  eventPaidClass,
  eventTone,
} from './ScheduleWeekBoard';

const LANE_H = 84;
/** Минимальная ширина часа: уже — включается горизонтальная прокрутка. */
const MIN_HOUR_PX = 168;

function lessonsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'занятие';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'занятия';
  return 'занятий';
}

type Props = {
  day: Date;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours?: TeacherWorkingHoursData;
  selectedEventId: string | null;
  nowMs: number;
  canCreate: boolean;
  /** Показывать заголовок дня (в режиме «День» дата уже в шапке). */
  showHeading?: boolean;
  onSelectEvent: (event: ScheduleEvent) => void;
  onCreateAt: (day: Date, startTime: string, endTime: string) => void;
  onSelectBlockSlot?: (slot: TeacherDaySlot) => void;
};

function timeRange(event: ScheduleEvent): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(event.startsAt)} \u2013 ${fmt(event.endsAt)}`;
}

export default function ScheduleDayTimeline({
  day,
  events,
  daySlots,
  workingHours,
  selectedEventId,
  nowMs,
  canCreate,
  showHeading = true,
  onSelectEvent,
  onCreateAt,
  onSelectBlockSlot,
}: Props) {
  const dayEvents = useMemo(() => eventsForDay(events, day), [events, day]);
  const range = useMemo(() => computeHourRange([day], events, daySlots), [day, events, daySlots]);
  const fromMin = range.start * 60;
  const toMin = range.end * 60;
  const span = Math.max(toMin - fromMin, 60);
  const hours = Array.from({ length: Math.max(range.end - range.start, 1) }, (_, i) => range.start + i);
  const pct = (minutes: number) => ((minutes - fromMin) / span) * 100;

  const work = getDayWorkState(workingHours, day);
  const key = dateKey(day);
  const laid = useMemo(() => layoutDayEvents(dayEvents), [dayEvents]);
  const rows = Math.max(1, ...laid.map((item) => item.lane + 1));
  const blockSlots = daySlots.filter((slot) => slot.slotDate === key && slot.slotKind !== 'extra');
  const today = nowMs > 0 ? new Date(nowMs) : null;
  const nowMin = today && isSameDay(today, day) ? today.getHours() * 60 + today.getMinutes() : null;
  const dim =
    work.kind === 'off'
      ? [{ start: fromMin, end: toMin }]
      : work.kind === 'work'
        ? nonWorkingSegments(work.bands, fromMin, toMin)
        : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Фокус: первое занятие дня, иначе текущее время, иначе начало рабочего времени.
    let target = fromMin;
    if (laid.length > 0) {
      const first = new Date(laid[0].event.startsAt);
      target = first.getHours() * 60 + first.getMinutes() - 60;
    } else if (nowMin != null) target = nowMin - 60;
    else if (work.kind === 'work' && work.bands[0]) target = timeToMinutes(work.bands[0].startTime) - 30;
    target = Math.max(fromMin, target);
    el.scrollLeft = Math.max(0, (pct(target) / 100) * el.scrollWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const handleBodyClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canCreate || work.kind === 'off') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawMin = fromMin + ((event.clientX - rect.left) / rect.width) * span;
    const start = snapMinutes(Math.max(fromMin, Math.min(rawMin, toMin - 15)));
    const end = Math.min(start + SR_DEFAULT_DURATION, 24 * 60 - 1);
    if (work.kind === 'work' && !isInsideBands(work.bands, start, Math.min(start + 15, end))) return;
    const startTime = minutesToTime(start);
    if (slotOverlapsLesson(key, startTime, minutesToTime(Math.min(start + 15, end)), events)) return;
    onCreateAt(day, startTime, minutesToTime(end));
  };

  if (work.kind === 'off' && dayEvents.length === 0) {
    return (
      <div className="sr-dt sr-dt--off">
        {showHeading ? <h3 className="sr-dt-title">{formatDayHeading(day, nowMs)}</h3> : null}
        <p className="sr-dt-off">
          <IconPalmRef size={16} /> {work.note?.trim() || 'Выходной'}
        </p>
      </div>
    );
  }

  return (
    <div className="sr-dt">
      <div className="sr-dt-head">
        <div className="sr-dt-headline">
          {showHeading ? <h3 className="sr-dt-title">{formatDayHeading(day, nowMs)}</h3> : null}
          <span className="sr-dt-count">
            {dayEvents.length > 0 ? `${dayEvents.length} ${lessonsWord(dayEvents.length)}` : 'Занятий нет'}
          </span>
        </div>
        <span className="sr-dt-work">
          {work.kind === 'work'
            ? `Рабочее время: ${workBandsLabel(work.bands)}`
            : work.kind === 'off'
              ? work.note?.trim() || 'Выходной'
              : 'Рабочее время не задано'}
        </span>
      </div>
      <div className="sr-dt-scroll" ref={scrollRef}>
        <div className="sr-dt-inner" style={{ minWidth: hours.length * MIN_HOUR_PX }}>
          <div className="sr-dt-axis">
            {hours.map((hour) => (
              <span key={hour} className="sr-dt-hour" style={{ left: `${pct(hour * 60)}%` }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          <div
            className={`sr-dt-body${canCreate && work.kind !== 'off' ? ' is-clickable' : ''}`}
            style={{ height: rows * LANE_H + 8 }}
            onClick={handleBodyClick}
          >
            {hours.map((hour) => (
              <div key={hour} className="sr-dt-line" style={{ left: `${pct(hour * 60)}%` }} />
            ))}
            {dim.map((segment) => (
              <div
                key={`${segment.start}-${segment.end}`}
                className="sr-dt-nonwork"
                style={{ left: `${pct(segment.start)}%`, width: `${pct(segment.end) - pct(segment.start)}%` }}
              />
            ))}
            {nowMin != null && nowMin >= fromMin && nowMin <= toMin ? (
              <div className="sr-dt-now" style={{ left: `${pct(nowMin)}%` }} aria-hidden />
            ) : null}
            {blockSlots.map((slot) => {
              const left = pct(timeToMinutes(slot.startTime));
              const width = pct(timeToMinutes(slot.endTime)) - left;
              return (
                <div
                  key={slot.id}
                  className={`sr-dt-block${onSelectBlockSlot ? ' is-clickable' : ''}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectBlockSlot?.(slot);
                  }}
                >
                  <span>{slot.slotKind === 'break' ? 'Перерыв' : slot.label?.trim() || 'Занято'}</span>
                </div>
              );
            })}
            {laid.map(({ event, lane }) => {
              const start = new Date(event.startsAt);
              const startMin = start.getHours() * 60 + start.getMinutes();
              const left = pct(startMin);
              const width = (event.durationMinutes / span) * 100;
              const payLabel = eventPaymentLabel(event);
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`sr-ev sr-dt-ev sr-ev--tone-${eventTone(event)}${eventPaidClass(event)}${selectedEventId === event.id ? ' is-selected' : ''}${event.durationMinutes <= 60 ? ' is-short' : ''}`}
                  title={`${timeRange(event)} \u00b7 ${eventHeadline(event)} \u00b7 ${eventSubline(event)}`}
                  style={{
                    left: `calc(${left}% + 1px)`,
                    width: `calc(${width}% - 3px)`,
                    top: 4 + lane * LANE_H,
                    height: LANE_H - 6,
                    right: 'auto',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(event);
                  }}
                >
                  <span className="sr-dt-ev-top">
                    <span className="sr-ev-time">{timeRange(event)}</span>
                    <span className="sr-dt-ev-icon">
                      <EventKindIcon kind={event.kind} />
                    </span>
                  </span>
                  <strong className="sr-ev-name">{eventHeadline(event)}</strong>
                  <span className="sr-dt-ev-foot">
                    <span className="sr-ev-sub">{eventSubline(event)}</span>
                    {payLabel ? (
                      <span
                        className={`sr-dt-pay sr-dt-pay--${payLabel}`}
                        aria-label={payLabel === 'paid' ? 'Оплачено' : 'Не оплачено'}
                      >
                        {payLabel === 'paid' ? 'Оплачено' : 'Ждёт оплаты'}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
