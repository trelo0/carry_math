'use client';

import type { DayTimelineSegment, ScheduleEvent, TeacherAvailabilitySlot } from '@/lib/teacher/schedule-types';
import {
  availabilityBandsForDay,
  countDayTimelineStats,
  formatNavDateLong,
  formatTimeRange,
  isoToTimeLabel,
  kindBadgeLabel,
} from '@/lib/teacher/schedule-utils';
import { IconClock, IconPencil } from './ScheduleIcons';

type Props = {
  day: Date;
  segments: DayTimelineSegment[];
  availability: TeacherAvailabilitySlot[];
  nextEvent: ScheduleEvent | null;
  showWorkHours: boolean;
  onEditWorkHours?: () => void;
  onSelectEvent: (event: ScheduleEvent) => void;
};

export default function ScheduleDaySummaryPanel({
  day,
  segments,
  availability,
  nextEvent,
  showWorkHours,
  onEditWorkHours,
  onSelectEvent,
}: Props) {
  const stats = countDayTimelineStats(segments);
  const workBands = availabilityBandsForDay(availability, day);

  return (
    <aside className="sched-aside">
      <section className="sched-aside-block">
        <h2 className="sched-aside-label">{formatNavDateLong(day)}</h2>
        <div className="sched-stat-row">
          <div className="sched-stat">
            <span className="sched-stat-num">{stats.lessons}</span>
            <span className="sched-stat-cap">занятий</span>
          </div>
          {showWorkHours ? (
            <div className="sched-stat">
              <span className="sched-stat-num">{stats.freeSlots}</span>
              <span className="sched-stat-cap">свободных слота</span>
            </div>
          ) : null}
        </div>
      </section>

      {showWorkHours ? (
        <section className="sched-aside-block">
          <h2 className="sched-aside-label">Рабочее время</h2>
          {workBands.length === 0 ? (
            <p className="sched-aside-muted">Не задано</p>
          ) : (
            <ul className="sched-aside-hours">
              {workBands.map((band) => (
                <li key={`${band.startTime}-${band.endTime}`}>
                  {formatTimeRange(band.startTime, band.endTime)}
                </li>
              ))}
            </ul>
          )}
          {onEditWorkHours ? (
            <button type="button" className="sched-btn sched-btn--outline-teal" onClick={onEditWorkHours}>
              <IconPencil />
              Изменить
            </button>
          ) : null}
        </section>
      ) : null}

      {nextEvent ? (
        <section className="sched-aside-block">
          <h2 className="sched-aside-label">Ближайшее занятие</h2>
          <button
            type="button"
            className={`sched-next-card sched-next-card--${nextEvent.kind}`}
            onClick={() => onSelectEvent(nextEvent)}
          >
            <div className="sched-next-card-top">
              <IconClock className="sched-next-card-clock" />
              <span className="sched-next-card-time">
                {isoToTimeLabel(nextEvent.startsAt)} — {isoToTimeLabel(nextEvent.endsAt)}
              </span>
            </div>
            <span className="sched-next-card-badge">{kindBadgeLabel(nextEvent.kind)}</span>
            <strong className="sched-next-card-title">{nextEvent.title}</strong>
            <span className="sched-next-card-meta">{nextEvent.participantLabel}</span>
          </button>
        </section>
      ) : null}

      {showWorkHours ? (
        <section className="sched-aside-block sched-aside-tip">
          <h2 className="sched-aside-label">Полезная информация</h2>
          <p>Занятия можно назначать только в рамках рабочего времени. Свободные слоты отображаются в расписании дня.</p>
        </section>
      ) : null}
    </aside>
  );
}
