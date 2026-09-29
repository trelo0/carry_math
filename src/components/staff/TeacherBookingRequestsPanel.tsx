'use client';

import { useState } from 'react';
import type { LessonBookingView } from '@/lib/teacher/booking-types';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  bookings: LessonBookingView[];
  busy: boolean;
  runAction: StaffRunAction;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kindLabel(kind: LessonBookingView['kind']): string {
  return kind === 'individual' ? 'Индивидуальное' : 'Групповое';
}

export default function TeacherBookingRequestsPanel({ bookings, busy, runAction }: Props) {
  const pending = bookings.filter((b) => b.status === 'pending');
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const confirm = (id: string) => {
    void runWithKeyedFeedback(runAction, setFeedbacks, id, async () => {
      const res = await fetch(`/api/cabinet/teacher/booking/requests/${id}/confirm`, { method: 'POST' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось подтвердить');
    }, 'Заявка подтверждена');
  };

  const reject = (id: string) => {
    void runWithKeyedFeedback(runAction, setFeedbacks, `${id}-reject`, async () => {
      const res = await fetch(`/api/cabinet/teacher/booking/requests/${id}/reject`, { method: 'POST' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось отклонить');
    }, 'Заявка отклонена');
  };

  return (
    <div className="curator-panel">
      <h1 className="curator-title">Заявки на занятия</h1>
      <p className="curator-muted">Подтверждайте записи учеников на обычные занятия.</p>

      {pending.length === 0 ? (
        <p className="curator-muted">Нет заявок, ожидающих подтверждения.</p>
      ) : (
        <ul className="staff-booking-requests">
          {pending.map((b) => (
            <li key={b.id} className="staff-booking-card">
              <header>
                <h2>Заявка на занятие</h2>
                <span>{b.studentName ?? `ID ${b.studentTelegramId}`}</span>
              </header>
              <p>{kindLabel(b.kind)}</p>
              <p>
                {formatDateTime(b.startsAt)} · {b.durationMinutes} мин
              </p>
              {b.groupTitle ? <p>Группа: {b.groupTitle}</p> : null}
              <p className="staff-booking-status">Ожидает подтверждения</p>
              <div className="schedule-side-actions">
                <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={() => confirm(b.id)}>
                  Подтвердить
                </button>
                <button type="button" className="curator-btn" disabled={busy} onClick={() => reject(b.id)}>
                  Отклонить
                </button>
              </div>
              <CabinetFeedback feedback={feedbacks[b.id] ?? feedbacks[`${b.id}-reject`]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
