'use client';

import { useEffect, useState } from 'react';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { addTeacherDaySlot, patchTeacherDaySlot, removeTeacherDaySlot } from '@/lib/teacher/schedule-optimistic';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { findDaySlotConflict, formatTimeRange } from '@/lib/teacher/schedule-utils';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  slot: TeacherDaySlot;
  events: ScheduleEvent[];
  allDaySlots: TeacherDaySlot[];
  busy: boolean;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  runAction: StaffRunAction;
  onClose: () => void;
  onDeleted: () => void;
  onAddLesson: (slot: TeacherDaySlot) => void;
};

export default function ScheduleSlotSidePanel({
  slot,
  events,
  allDaySlots,
  busy,
  patchTeacher,
  runAction,
  onClose,
  onDeleted,
  onAddLesson,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState(slot.startTime);
  const [endTime, setEndTime] = useState(slot.endTime);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  useEffect(() => {
    setEditing(false);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    setFeedback(null);
  }, [slot.id, slot.startTime, slot.endTime]);

  const save = () => {
    const conflict = findDaySlotConflict(
      slot.slotDate,
      startTime,
      endTime,
      events,
      allDaySlots,
      slot.id,
    );
    if (conflict) {
      setFeedback({ type: 'error', message: conflict });
      return;
    }

    const slotId = slot.id;
    patchTeacher?.((prev) => patchTeacherDaySlot(prev, slotId, { startTime, endTime }));
    setEditing(false);
    void runWithFeedback(runAction, setFeedback, async () => {
      const res = await fetch('/api/cabinet/teacher/day-slots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, startTime, endTime }),
      });
      if (!res.ok) {
        patchTeacher?.((prev) =>
          patchTeacherDaySlot(prev, slotId, { startTime: slot.startTime, endTime: slot.endTime }),
        );
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
    }, 'Слот обновлён', { refresh: 'none' });
  };

  const remove = () => {
    const slotId = slot.id;
    patchTeacher?.((prev) => removeTeacherDaySlot(prev, slotId));
    onDeleted();
    void runWithFeedback(runAction, setFeedback, async () => {
      const res = await fetch(`/api/cabinet/teacher/day-slots?slotId=${slotId}`, { method: 'DELETE' });
      if (!res.ok) {
        patchTeacher?.((prev) => addTeacherDaySlot(prev, slot));
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось удалить');
      }
    }, 'Слот удалён', { refresh: 'none' });
  };

  const cancelEdit = () => {
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    setEditing(false);
    setFeedback(null);
  };

  return (
    <aside className="sched-aside sched-slot-panel">
      <section className="sched-aside-block sched-slot-panel-card">
        <button type="button" className="sched-lesson-back" onClick={onClose}>
          ← К дню
        </button>

        <span className="sched-slot-panel-badge">Свободный слот</span>
        <p className="sched-slot-panel-range">{formatTimeRange(slot.startTime, slot.endTime)}</p>

        {editing ? (
          <div className="sched-slot-panel-form">
            <div className="schedule-modal-row">
              <label>
                Начало
                <input type="time" className="sched-time-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <label>
                Окончание
                <input type="time" className="sched-time-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
            <CabinetFeedback feedback={feedback} />
            <div className="sched-slot-panel-actions sched-slot-panel-actions--row">
              <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={save}>
                Сохранить
              </button>
              <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={cancelEdit}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <CabinetFeedback feedback={feedback} />
            <div className="sched-slot-panel-actions">
              <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={() => setEditing(true)}>
                Изменить
              </button>
              <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={remove}>
                Удалить
              </button>
              <button
                type="button"
                className="sched-btn sched-btn--primary"
                disabled={busy}
                onClick={() => onAddLesson(slot)}
              >
                Добавить занятие
              </button>
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
