'use client';

import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { formatDayAsideHeading, formatTimeRange } from '@/lib/teacher/schedule-utils';

type Props = {
  day: Date;
  freeSlots: TeacherDaySlot[];
  showSettings: boolean;
  onAddSlot: () => void;
  onAutoFill: () => void;
  onSelectSlot: (slot: TeacherDaySlot) => void;
};

export default function ScheduleDaySettingsPanel({
  day,
  freeSlots,
  showSettings,
  onAddSlot,
  onAutoFill,
  onSelectSlot,
}: Props) {
  const heading = formatDayAsideHeading(day);

  return (
    <aside className="sched-aside">
      <section className="sched-aside-block sched-day-settings">
        <div className="sched-day-aside-head">
          <span className="sched-day-aside-wd">{heading.weekday}</span>
          <strong className="sched-day-aside-date">{heading.dateLine}</strong>
        </div>

        {showSettings ? (
          <>
            <h3 className="sched-aside-label">Свободные слоты</h3>
            {freeSlots.length === 0 ? (
              <p className="sched-aside-muted">Нет свободных слотов на этот день</p>
            ) : (
              <ul className="sched-free-slot-list">
                {freeSlots.map((slot) => (
                  <li key={slot.id}>
                    <button
                      type="button"
                      className="sched-free-slot-item"
                      onClick={() => onSelectSlot(slot)}
                    >
                      {formatTimeRange(slot.startTime, slot.endTime)}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="sched-day-actions">
              <button type="button" className="sched-btn sched-btn--outline-teal" onClick={onAddSlot}>
                + Добавить слот
              </button>
              <button type="button" className="sched-btn sched-btn--ghost" onClick={onAutoFill}>
                Автозаполнение
              </button>
            </div>
          </>
        ) : null}
      </section>
    </aside>
  );
}
