'use client';

import { useState } from 'react';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { addTeacherDaySlot } from '@/lib/teacher/schedule-optimistic';
import { dateKey, findDaySlotConflict } from '@/lib/teacher/schedule-utils';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  day: Date;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  busy: boolean;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
  runAction: StaffRunAction;
};

export default function ScheduleSlotFormModal({
  day,
  events,
  daySlots,
  busy,
  patchTeacher,
  onClose,
  runAction,
}: Props) {
  const slotDate = dateKey(day);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const submit = () => {
    const conflict = findDaySlotConflict(slotDate, startTime, endTime, events, daySlots);
    if (conflict) {
      setFeedback({ type: 'error', message: conflict });
      return;
    }

    void runWithFeedback(runAction, setFeedback, async () => {
      const res = await fetch('/api/cabinet/teacher/day-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotDate, startTime, endTime, slotKind: 'extra' }),
      });
      const body = (await res.json()) as { error?: string; slot?: TeacherDaySlot };
      if (!res.ok) {
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
      if (body.slot) {
        patchTeacher?.((prev) => addTeacherDaySlot(prev, body.slot!));
      }
      onClose();
    }, 'Слот добавлен', { refresh: 'none' });
  };

  return (
    <div className="schedule-modal-overlay" role="dialog" aria-modal="true">
      <div className="schedule-modal sched-modal">
        <header className="schedule-modal-head">
          <h2>Добавить слот</h2>
          <button type="button" className="sched-icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>
        <div className="schedule-modal-form">
          <div className="schedule-modal-row">
            <label>
              Начало
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label>
              Окончание
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
          <CabinetFeedback feedback={feedback} />
          <div className="schedule-side-actions">
            <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={submit}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
