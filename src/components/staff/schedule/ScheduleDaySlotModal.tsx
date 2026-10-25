'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { formatScheduleApiError, readJson } from '@/lib/teacher/schedule-api-errors';
import { dateKey, durationFromRange } from '@/lib/teacher/schedule-utils';
import { addTeacherDaySlot, removeTeacherDaySlot } from '@/lib/teacher/schedule-optimistic';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { ScheduleTimeField } from './SchedulePickers';
import { IconXRef } from './ScheduleRefIcons';

type Props = {
  day: Date;
  /** Редактирование существующего слота (удаление). */
  existing?: TeacherDaySlot;
  busy: boolean;
  runAction: StaffRunAction;
  report: Dispatch<SetStateAction<ActionFeedback | null>>;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
};

export default function ScheduleDaySlotModal({
  day,
  existing,
  busy,
  runAction,
  report,
  patchTeacher,
  onClose,
}: Props) {
  const slotDate = existing?.slotDate ?? dateKey(day);
  const [startTime, setStartTime] = useState(existing?.startTime ?? '12:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '13:00');
  const [slotKind, setSlotKind] = useState<'break' | 'blocked'>(existing?.slotKind === 'break' ? 'break' : 'blocked');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [saving, setSaving] = useState(false);

  const valid = durationFromRange(startTime, endTime) > 0;

  const remove = () => {
    if (!existing) return;
    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const res = await fetch(`/api/cabinet/teacher/day-slots?slotId=${existing.id}`, { method: 'DELETE' });
        const body = await readJson<{ error: string }>(res);
        if (!res.ok) throw new Error(formatScheduleApiError(body.error, 'Не удалось удалить', res.status));
        patchTeacher?.((prev) => removeTeacherDaySlot(prev, existing.id));
      },
      'Интервал удалён',
      { refresh: 'none' },
    )
      .then((result) => {
        if (result?.type === 'success') {
          report(result);
          onClose();
        }
      })
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (!valid) return;
    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const res = await fetch('/api/cabinet/teacher/day-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slotDate,
            startTime,
            endTime,
            slotKind,
            label: label.trim() || null,
          }),
        });
        const body = await readJson<{ error: string; slot: TeacherDaySlot }>(res);
        const slot = body.slot;
        if (!res.ok || !slot) {
          throw new Error(formatScheduleApiError(body.error, 'Не удалось сохранить', res.status));
        }
        patchTeacher?.((prev) => addTeacherDaySlot(prev, slot));
      },
      'Интервал добавлен',
      { refresh: 'none' },
    )
      .then((result) => {
        if (result?.type === 'success') {
          report(result);
          onClose();
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="sr-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sr-modal" onClick={(e) => e.stopPropagation()}>
        <header className="sr-modal-head">
          <div>
            <h2 className="sr-modal-title">{existing ? 'Блок времени' : 'Перерыв или блокировка'}</h2>
            <p className="sr-modal-sub">{slotDate}</p>
          </div>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconXRef size={14} />
          </button>
        </header>
        <div className="sr-modal-body">
          {existing ? (
            <p className="sr-muted">
              {existing.slotKind === 'break' ? 'Перерыв' : existing.label?.trim() || 'Занято'}: {existing.startTime}–
              {existing.endTime}
            </p>
          ) : (
            <>
              <div className="sr-seg" role="tablist">
                <button
                  type="button"
                  className={`sr-seg-btn${slotKind === 'break' ? ' is-active' : ''}`}
                  onClick={() => setSlotKind('break')}
                >
                  Перерыв
                </button>
                <button
                  type="button"
                  className={`sr-seg-btn${slotKind === 'blocked' ? ' is-active' : ''}`}
                  onClick={() => setSlotKind('blocked')}
                >
                  Занято
                </button>
              </div>
              <div className="sr-field-row">
                <label className="sr-field">
                  <span>Начало</span>
                  <ScheduleTimeField value={startTime} onChange={setStartTime} aria-label="Начало" />
                </label>
                <label className="sr-field">
                  <span>Конец</span>
                  <ScheduleTimeField value={endTime} onChange={setEndTime} aria-label="Конец" />
                </label>
              </div>
              {slotKind === 'blocked' ? (
                <label className="sr-field">
                  <span>Подпись (необязательно)</span>
                  <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Личное" />
                </label>
              ) : null}
            </>
          )}
          <CabinetFeedback feedback={feedback} />
        </div>
        <footer className="sr-modal-foot">
          {existing ? (
            <button type="button" className="sr-btn sr-btn--danger" disabled={saving || busy} onClick={remove}>
              Удалить
            </button>
          ) : null}
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          {!existing ? (
            <button type="button" className="sr-btn sr-btn--primary" disabled={!valid || saving || busy} onClick={save}>
              Сохранить
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
