'use client';

import { useMemo, useState } from 'react';
import type { TeacherAvailabilitySlot } from '@/lib/teacher/schedule-types';
import { formatDayTitle, formatTimeRange } from '@/lib/teacher/schedule-utils';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { IconClock, IconPencil } from './ScheduleIcons';

const WEEKDAY_UPPER = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];

type Props = {
  day: Date;
  availability: TeacherAvailabilitySlot[];
  busy: boolean;
  runAction: StaffRunAction;
  variant?: 'compact' | 'full' | 'settings';
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
};

function dayOfWeekIndex(date: Date): number {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

export function dayHeadingUpper(date: Date): string {
  const idx = dayOfWeekIndex(date);
  const monthDay = formatDayTitle(date).split(', ')[1] ?? '';
  return `${WEEKDAY_UPPER[idx]} · ${monthDay.toUpperCase()}`;
}

export default function ScheduleDayWorkHours({
  day,
  availability,
  busy,
  runAction,
  variant = 'full',
  editing: editingProp,
  onEditingChange,
}: Props) {
  const dayIndex = dayOfWeekIndex(day);
  const slots = useMemo(
    () =>
      availability
        .filter((slot) => slot.dayOfWeek === dayIndex)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [availability, dayIndex],
  );

  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingProp ?? editingInternal;
  const setEditing = onEditingChange ?? setEditingInternal;

  const [activeEditId, setActiveEditId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const resetForm = () => {
    setEditing(false);
    setActiveEditId(null);
    setAdding(false);
    setStartTime('09:00');
    setEndTime('13:00');
  };

  const openEdit = () => {
    setEditing(true);
    setActiveEditId(null);
    setAdding(false);
  };

  const startChange = (slot: TeacherAvailabilitySlot) => {
    setEditing(true);
    setActiveEditId(slot.id);
    setAdding(false);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
  };

  const startAdd = () => {
    setEditing(true);
    setActiveEditId(null);
    setAdding(true);
    setStartTime('09:00');
    setEndTime('13:00');
  };

  const submit = () => {
    void runWithFeedback(runAction, setFeedback, async () => {
      if (startTime >= endTime) {
        throw new Error('Время начала должно быть раньше окончания');
      }
      if (activeEditId) {
        const del = await fetch(`/api/cabinet/teacher/availability?slotId=${activeEditId}`, { method: 'DELETE' });
        if (!del.ok) {
          const body = (await del.json()) as { error?: string };
          throw new Error(body.error ?? 'Не удалось обновить интервал');
        }
      }
      const res = await fetch('/api/cabinet/teacher/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayOfWeek: dayIndex, startTime, endTime, kind: 'both' }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
      resetForm();
    }, activeEditId ? 'Интервал обновлён' : 'Интервал добавлен');
  };

  const remove = (slotId: number) => {
    void runWithFeedback(runAction, setFeedback, async () => {
      const res = await fetch(`/api/cabinet/teacher/availability?slotId=${slotId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось удалить интервал');
      }
      if (activeEditId === slotId) resetForm();
    }, 'Интервал удалён');
  };

  const editForm = (
    <div className="sched-work-edit">
      {slots.length > 0 ? (
        <ul className="sched-work-edit-list">
          {slots.map((slot) => (
            <li key={slot.id}>
              <span>{formatTimeRange(slot.startTime, slot.endTime)}</span>
              <span className="staff-availability-slot-actions">
                <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={() => startChange(slot)}>
                  Изменить
                </button>
                <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={() => remove(slot.id)}>
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {adding || activeEditId ? (
        <div className="staff-availability-form">
          <div className="schedule-modal-row">
            <label>
              С
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label>
              До
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
          <div className="schedule-side-actions">
            <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={submit}>
              {activeEditId ? 'Сохранить' : 'Добавить'}
            </button>
            <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={resetForm}>
              Отмена
            </button>
          </div>
          <CabinetFeedback feedback={feedback} />
        </div>
      ) : (
        <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={startAdd}>
          + Добавить время
        </button>
      )}
    </div>
  );

  if (variant === 'settings') {
    return (
      <div className="sched-work-settings">
        <h3 className="sched-work-settings-title">Рабочее время</h3>
        {!editing ? (
          slots.length === 0 ? (
            <p className="sched-aside-muted">Не задано для этого дня недели</p>
          ) : (
            <ul className="sched-aside-hours">
              {slots.map((slot) => (
                <li key={slot.id}>{formatTimeRange(slot.startTime, slot.endTime)}</li>
              ))}
            </ul>
          )
        ) : null}
        {!editing ? (
          <button type="button" className="sched-btn sched-btn--outline-teal" disabled={busy} onClick={openEdit}>
            <IconPencil />
            Настроить
          </button>
        ) : (
          editForm
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="sched-work-bar">
        <div className="sched-work-bar-main">
          <IconClock className="sched-work-bar-clock" />
          <span className="sched-work-bar-label">Рабочее время</span>
          {!editing ? (
            slots.length === 0 ? (
              <span className="sched-work-bar-empty">Не задано</span>
            ) : (
              <span className="sched-work-bar-slots">
                {slots.map((slot) => (
                  <span key={slot.id}>{formatTimeRange(slot.startTime, slot.endTime)}</span>
                ))}
              </span>
            )
          ) : null}
        </div>
        {!editing ? (
          <button type="button" className="sched-btn sched-btn--ghost sched-btn--sm" disabled={busy} onClick={openEdit}>
            <IconPencil />
            Изменить
          </button>
        ) : null}
        {editing ? editForm : null}
      </div>
    );
  }

  return (
    <section className="schedule-day-work-hours">
      <header className="schedule-day-work-hours-head">
        <div>
          <p className="schedule-day-work-hours-kicker">{dayHeadingUpper(day)}</p>
          <h2 className="schedule-day-work-hours-title">Рабочее время</h2>
        </div>
        {!editing ? (
          <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={openEdit}>
            Изменить
          </button>
        ) : null}
      </header>
      {!editing ? (
        slots.length === 0 ? (
          <p className="schedule-day-work-hours-empty">Рабочие интервалы не заданы</p>
        ) : (
          <ul className="schedule-day-work-hours-slots">
            {slots.map((slot) => (
              <li key={slot.id}>{formatTimeRange(slot.startTime, slot.endTime)}</li>
            ))}
          </ul>
        )
      ) : (
        editForm
      )}
    </section>
  );
}
