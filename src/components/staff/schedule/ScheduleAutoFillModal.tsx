'use client';

import { useMemo, useState } from 'react';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { addTeacherDaySlots } from '@/lib/teacher/schedule-optimistic';
import {
  dateKey,
  formatTimeRange,
  generateAutoSlots,
  partitionAutoSlots,
} from '@/lib/teacher/schedule-utils';
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

export default function ScheduleAutoFillModal({
  day,
  events,
  daySlots,
  busy,
  patchTeacher,
  onClose,
  runAction,
}: Props) {
  const slotDate = dateKey(day);
  const [durationMinutes, setDurationMinutes] = useState(75);
  const [firstStart, setFirstStart] = useState('09:00');
  const [lastStart, setLastStart] = useState('20:00');
  const [breakMinutes, setBreakMinutes] = useState(15);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const preview = useMemo(() => {
    const candidates = generateAutoSlots({ durationMinutes, firstStart, lastStart, breakMinutes });
    return partitionAutoSlots(slotDate, candidates, events, daySlots);
  }, [slotDate, durationMinutes, firstStart, lastStart, breakMinutes, events, daySlots]);

  const createAll = () => {
    if (preview.creatable.length === 0) {
      setFeedback({ type: 'error', message: 'Нет слотов для создания — все пересекаются с занятиями или слотами' });
      return;
    }

    const optimisticSlots: TeacherDaySlot[] = preview.creatable.map((slot, index) => ({
      id: -(Date.now() + index),
      slotDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotKind: 'extra',
      label: null,
    }));
    patchTeacher?.((prev) => addTeacherDaySlots(prev, optimisticSlots));
    onClose();

    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        for (const slot of preview.creatable) {
          const res = await fetch('/api/cabinet/teacher/day-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slotDate,
              startTime: slot.startTime,
              endTime: slot.endTime,
              slotKind: 'extra',
            }),
          });
          if (!res.ok) {
            const body = (await res.json()) as { error?: string };
            throw new Error(body.error ?? 'Не удалось создать слоты');
          }
        }
      },
      preview.skipped > 0
        ? `Создано ${preview.creatable.length}, пропущено ${preview.skipped}`
        : `Создано ${preview.creatable.length} слотов`,
    );
  };

  return (
    <div className="schedule-modal-overlay" role="dialog" aria-modal="true">
      <div className="schedule-modal sched-modal sched-autofill-modal">
        <header className="schedule-modal-head">
          <h2>Автозаполнение</h2>
          <button type="button" className="sched-icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>
        <div className="schedule-modal-form">
          <label>
            Длительность занятия (мин)
            <input
              type="number"
              min={15}
              step={5}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
          </label>
          <div className="schedule-modal-row">
            <label>
              Первый старт
              <input type="time" value={firstStart} onChange={(e) => setFirstStart(e.target.value)} />
            </label>
            <label>
              Последний старт
              <input type="time" value={lastStart} onChange={(e) => setLastStart(e.target.value)} />
            </label>
          </div>
          <label>
            Перерыв между занятиями (мин)
            <input
              type="number"
              min={0}
              step={5}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Number(e.target.value))}
            />
          </label>

          <p className="sched-autofill-summary">
            Будет создано: <strong>{preview.creatable.length}</strong> слотов
            {preview.skipped > 0 ? (
              <span className="sched-autofill-skipped"> · пропущено {preview.skipped}</span>
            ) : null}
          </p>

          {preview.creatable.length > 0 ? (
            <ul className="sched-autofill-preview">
              {preview.creatable.map((slot) => (
                <li key={`${slot.startTime}-${slot.endTime}`}>
                  {formatTimeRange(slot.startTime, slot.endTime)}
                </li>
              ))}
            </ul>
          ) : null}

          <CabinetFeedback feedback={feedback} />
          <div className="schedule-side-actions">
            <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="sched-btn sched-btn--primary"
              disabled={busy || preview.creatable.length === 0}
              onClick={createAll}
            >
              Создать {preview.creatable.length} слотов
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
