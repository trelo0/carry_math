'use client';

import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { formatTimeRange } from '@/lib/teacher/schedule-utils';

type Props = {
  slot: TeacherDaySlot;
  top: number;
  height: number;
  isSelected?: boolean;
  onClick?: (slot: TeacherDaySlot) => void;
};

export default function ScheduleDaySlotBlock({ slot, top, height, isSelected, onClick }: Props) {
  const isFree = slot.slotKind === 'extra';
  const compact = height < 44;
  const timeLabel = formatTimeRange(slot.startTime, slot.endTime);

  if (!isFree) {
    return (
      <div
        className={`sched-day-slot sched-day-slot--${slot.slotKind === 'break' ? 'break' : 'busy'}`}
        style={{ top: `${top}px`, height: `${Math.max(height, 24)}px` }}
      >
        <span className="sched-day-slot-accent" aria-hidden />
        <span className="sched-day-slot-label">
          {slot.slotKind === 'break' ? 'Перерыв' : slot.label?.trim() || 'Занято'}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`sched-day-slot sched-day-slot--free${isSelected ? ' is-selected' : ''}`}
      style={{ top: `${top}px`, height: `${Math.max(height, 24)}px` }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(slot);
      }}
    >
      <span className="sched-day-slot-accent" aria-hidden />
      {!compact ? (
        <>
          <span className="sched-day-slot-time">{timeLabel}</span>
          <span className="sched-day-slot-label">Свободно</span>
        </>
      ) : (
        <span className="sched-day-slot-label">Свободно</span>
      )}
    </button>
  );
}
