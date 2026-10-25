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
  WEEKDAYS_SHORT,
  computeHourRange,
  formatDayShort,
  getDayWorkState,
  isInsideBands,
  layoutDayEvents,
  nonWorkingSegments,
  snapMinutes,
  weekdayIndex,
  workBandsLabel,
} from '@/lib/teacher/schedule-reference-utils';
import type { TeacherWorkingHoursData } from '@/lib/teacher/working-hours';
import { teacherLessonPaymentChipShort, teacherLessonPaymentChipAria } from '@/lib/teacher/schedule-payment-labels';
import {
  IconCheckRef,
  IconPalmRef,
  IconUserRef,
  IconUsersRef,
  IconVideoRef,
  IconXRef,
} from './ScheduleRefIcons';

export const SR_HOUR_PX = 56;
export const SR_DEFAULT_DURATION = 75;

type Props = {
  days: Date[];
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours?: TeacherWorkingHoursData;
  selectedDay: Date;
  selectedEventId: string | null;
  nowMs: number;
  canCreate: boolean;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: ScheduleEvent) => void;
  onCreateAt: (day: Date, startTime: string, endTime: string) => void;
  onSelectBlockSlot?: (slot: TeacherDaySlot) => void;
};

const KIND_SHORT: Record<ScheduleEvent['kind'], string> = {
  individual: 'Индивидуально',
  group: 'Групповое',
  course: 'Курс',
};

const GENERIC_TOPICS = new Set(['Индивидуальное занятие', 'Групповое занятие', 'Занятие', '']);

export function eventHeadline(event: ScheduleEvent): string {
  return event.kind === 'course' ? event.title : event.participantLabel || event.title;
}

export function eventSubline(event: ScheduleEvent): string {
  if (event.kind === 'course') return KIND_SHORT.course;
  const topic = event.title.trim();
  const base = GENERIC_TOPICS.has(topic) ? KIND_SHORT[event.kind] : `${topic} · ${KIND_SHORT[event.kind]}`;
  return event.seriesId ? `${base} · Серия` : base;
}

export type EventTone = 'scheduled' | 'completed' | 'cancelled';

/** Цвет карточки — только статус проведения (оплата отдельным чипом). */
export function eventTone(event: ScheduleEvent): EventTone {
  if (event.status === 'cancelled' || event.status === 'no_show') return 'cancelled';
  if (event.status === 'completed') return 'completed';
  return 'scheduled';
}

export function eventPaymentLabel(event: ScheduleEvent): 'paid' | 'unpaid' | null {
  if (event.status !== 'scheduled') return null;
  return teacherLessonPaymentChipShort(event.isPaid);
}

export { teacherLessonPaymentChipAria };

export function EventKindIcon({ kind, size = 13 }: { kind: ScheduleEvent['kind']; size?: number }) {
  if (kind === 'group') return <IconUsersRef size={size} />;
  if (kind === 'course') return <IconVideoRef size={size} />;
  return <IconUserRef size={size} />;
}

function timeRange(event: ScheduleEvent): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(event.startsAt)} – ${fmt(event.endsAt)}`;
}

export default function ScheduleWeekBoard({
  days,
  events,
  daySlots,
  workingHours,
  selectedDay,
  selectedEventId,
  nowMs,
  canCreate,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
  onSelectBlockSlot,
}: Props) {
  const range = computeHourRange(days, events, daySlots);
  const hours = Array.from({ length: Math.max(range.end - range.start, 1) }, (_, i) => range.start + i);
  const bodyHeight = hours.length * SR_HOUR_PX;
  const fromMin = range.start * 60;
  const toMin = range.end * 60;
  const px = (minutes: number) => ((minutes - fromMin) / 60) * SR_HOUR_PX;
  const today = useMemo(() => (nowMs > 0 ? new Date(nowMs) : null), [nowMs]);
  const single = days.length === 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (scrolledRef.current || !scrollRef.current) return;
    const includesToday = today ? days.some((day) => isSameDay(day, today)) : false;
    let targetMin = fromMin;
    if (includesToday && today) {
      targetMin = Math.max(fromMin, today.getHours() * 60 + today.getMinutes() - 30);
    } else {
      for (const day of days) {
        const work = getDayWorkState(workingHours, day);
        if (work.kind === 'work' && work.bands[0]) {
          targetMin = Math.min(targetMin, timeToMinutes(work.bands[0].startTime));
        }
      }
    }
    const topPx = ((targetMin - fromMin) / 60) * SR_HOUR_PX;
    scrollRef.current.scrollTop = Math.max(0, topPx - 24);
    scrolledRef.current = true;
  }, [days, fromMin, today, workingHours]);

  const handleBodyClick = (
    event: MouseEvent<HTMLDivElement>,
    day: Date,
    workBands: { startTime: string; endTime: string }[] | null,
    isOff: boolean,
  ) => {
    onSelectDay(day);
    if (!canCreate || isOff) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawMin = fromMin + ((event.clientY - rect.top) / SR_HOUR_PX) * 60;
    const start = snapMinutes(Math.max(fromMin, Math.min(rawMin, toMin - 15)));
    const end = Math.min(start + SR_DEFAULT_DURATION, 24 * 60 - 1);
    if (workBands && !isInsideBands(workBands, start, Math.min(start + 15, end))) return;
    const startTime = minutesToTime(start);
    const endTime = minutesToTime(end);
    const key = dateKey(day);
    if (slotOverlapsLesson(key, startTime, minutesToTime(Math.min(start + 15, end)), events)) return;
    onCreateAt(day, startTime, endTime);
  };

  return (
    <div className={`sr-board${single ? ' sr-board--single' : ''}`}>
      <div className="sr-board-scroll" ref={scrollRef}>
        <div
          className="sr-board-grid"
          style={{ gridTemplateColumns: `46px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="sr-axis">
            <div className="sr-axis-head" />
            <div className="sr-axis-body" style={{ height: bodyHeight }}>
              {hours.map((hour) => (
                <span key={hour} className="sr-axis-label" style={{ top: (hour - range.start) * SR_HOUR_PX }}>
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          </div>

          {days.map((day) => {
            const key = dateKey(day);
            const work = getDayWorkState(workingHours, day);
            const isSelected = isSameDay(day, selectedDay);
            const isTodayCol = today ? isSameDay(day, today) : false;
            const dayEvents = eventsForDay(events, day);
            const laid = layoutDayEvents(dayEvents);
            const blockSlots = daySlots.filter(
              (slot) => slot.slotDate === key && slot.slotKind !== 'extra',
            );
            const dim =
              work.kind === 'off'
                ? [{ start: fromMin, end: toMin }]
                : work.kind === 'work'
                  ? nonWorkingSegments(work.bands, fromMin, toMin)
                  : [];
            const nowMin = isTodayCol && today ? today.getHours() * 60 + today.getMinutes() : null;

            return (
              <div
                key={key}
                className={`sr-col${isSelected ? ' is-selected' : ''}${isTodayCol ? ' is-today' : ''}${work.kind === 'off' ? ' is-off' : ''}`}
              >
                <div className="sr-col-head">
                  <button type="button" className="sr-col-day" onClick={() => onSelectDay(day)}>
                    <span className="sr-col-wd">{WEEKDAYS_SHORT[weekdayIndex(day)]}</span>
                    <strong className="sr-col-date">{formatDayShort(day)}</strong>
                  </button>
                  <div className="sr-col-work">
                    {work.kind === 'work' ? (
                      <div className="sr-work-chip">
                        <span>Рабочее время</span>
                        <strong>{workBandsLabel(work.bands)}</strong>
                      </div>
                    ) : work.kind === 'off' ? (
                      <div className="sr-off-chip">
                        <span>{work.note?.trim() || 'Выходной'}</span>
                        <IconPalmRef size={18} />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  className="sr-col-body"
                  style={{ height: bodyHeight }}
                  onClick={(e) =>
                    handleBodyClick(e, day, work.kind === 'work' ? work.bands : null, work.kind === 'off')
                  }
                >
                  {hours.map((hour) => (
                    <div key={hour} className="sr-hour-line" style={{ top: (hour - range.start) * SR_HOUR_PX }} />
                  ))}

                  {dim.map((segment) => (
                    <div
                      key={`${segment.start}-${segment.end}`}
                      className="sr-nonwork"
                      style={{ top: px(segment.start), height: px(segment.end) - px(segment.start) }}
                    />
                  ))}

                  {nowMin != null && nowMin >= fromMin && nowMin <= toMin ? (
                    <div className="sr-now-line" style={{ top: px(nowMin) }} aria-hidden />
                  ) : null}

                  {blockSlots.map((slot) => {
                    const top = px(timeToMinutes(slot.startTime));
                    const height = px(timeToMinutes(slot.endTime)) - top;
                    return (
                      <div
                        key={slot.id}
                        className={`sr-block${onSelectBlockSlot ? ' is-clickable' : ''}`}
                        style={{ top, height: Math.max(height, 18) }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBlockSlot?.(slot);
                        }}
                      >
                        <span>{slot.slotKind === 'break' ? 'Перерыв' : slot.label?.trim() || 'Занято'}</span>
                      </div>
                    );
                  })}

                  {laid.map(({ event, lane, lanes, clusterStart, clusterEnd }) => {
                    const stacked = lanes > 1 && !single;
                    const start = new Date(event.startsAt);
                    const startMin = start.getHours() * 60 + start.getMinutes();
                    const clusterStartDate = new Date(clusterStart);
                    const clusterTop = px(clusterStartDate.getHours() * 60 + clusterStartDate.getMinutes());
                    const clusterHeight = ((clusterEnd - clusterStart) / 3600000) * SR_HOUR_PX;
                    const slotHeight = Math.max(clusterHeight / lanes, 34);
                    const top = stacked ? clusterTop + lane * slotHeight : px(startMin);
                    const height = stacked
                      ? slotHeight - 4
                      : Math.max((event.durationMinutes / 60) * SR_HOUR_PX - 3, 22);
                    const compact = stacked ? height < 52 : height < 44;
                    const payLabel = eventPaymentLabel(event);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        className={`sr-ev sr-ev--tone-${eventTone(event)}${selectedEventId === event.id ? ' is-selected' : ''}${compact ? ' is-compact' : ''}${stacked ? ' is-stack' : ''}`}
                        title={`${timeRange(event)} · ${eventHeadline(event)} · ${eventSubline(event)}`}
                        style={{
                          top: top + 1,
                          height,
                          ...(lanes > 1 && !stacked
                            ? {
                                left: `calc(${(lane / lanes) * 100}% + 4px)`,
                                width: `calc(${100 / lanes}% - 8px)`,
                              }
                            : { left: 4, right: 4 }),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDay(day);
                          onSelectEvent(event);
                        }}
                      >
                        <span className="sr-ev-time">
                          {stacked ? timeRange(event).split('–')[0].trim() : timeRange(event)}
                        </span>
                        <span className="sr-ev-icon">
                          <EventKindIcon kind={event.kind} />
                        </span>
                        <strong className="sr-ev-name">{eventHeadline(event)}</strong>
                        {!compact ? <span className="sr-ev-sub">{eventSubline(event)}</span> : null}
                        {payLabel ? (
                          <span
                            className={`sr-ev-pay sr-ev-pay--${payLabel}`}
                            aria-label={teacherLessonPaymentChipAria(payLabel)}
                          >
                            {payLabel === 'paid' ? 'Опл.' : 'Ждёт'}
                          </span>
                        ) : null}
                        {event.status === 'completed' ? (
                          <span className="sr-ev-state" aria-label="Проведено">
                            <IconCheckRef size={12} />
                          </span>
                        ) : event.status === 'cancelled' || event.status === 'no_show' ? (
                          <span className="sr-ev-state" aria-label={event.status === 'no_show' ? 'Не пришёл' : 'Отменено'}>
                            <IconXRef size={12} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}





