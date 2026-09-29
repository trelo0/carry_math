'use client';

import { useCallback, useMemo, useState } from 'react';
import type { LessonBookingView } from '@/lib/teacher/booking-types';

type Props = {
  kind: 'individual' | 'group';
  teacherTelegramId: number | null;
  groupId?: number | null;
  remaining: number;
  paymentsHref: string;
  initialBookings?: LessonBookingView[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: LessonBookingView['status']): string {
  if (status === 'pending') return 'Ожидает подтверждения';
  if (status === 'confirmed') return 'Подтверждено';
  if (status === 'rejected') return 'Отклонено';
  return 'Отменено';
}

export default function BookingPanel({
  kind,
  teacherTelegramId,
  groupId,
  remaining,
  paymentsHref,
  initialBookings = [],
}: Props) {
  const [bookings, setBookings] = useState(initialBookings);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [slots, setSlots] = useState<Array<{ startsAt: string; label: string }>>([]);
  const [available, setAvailable] = useState(remaining);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const pending = useMemo(
    () => bookings.filter((b) => b.kind === kind && b.status === 'pending'),
    [bookings, kind],
  );

  const refreshBookings = useCallback(async () => {
    const res = await fetch('/api/cabinet/booking/requests');
    if (!res.ok) return;
    const body = (await res.json()) as { bookings: LessonBookingView[] };
    setBookings(body.bookings ?? []);
  }, []);

  const loadSlots = useCallback(async () => {
    if (!teacherTelegramId) return;
    setLoadingSlots(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        teacherTelegramId: String(teacherTelegramId),
        kind,
        date,
      });
      const res = await fetch(`/api/cabinet/booking/slots?${params}`);
      const body = (await res.json()) as {
        slots?: Array<{ startsAt: string; label: string }>;
        credits?: { available: number; remaining: number };
        error?: string;
      };
      setSlots(body.slots ?? []);
      if (body.credits) setAvailable(body.credits.available);
      if (body.error) setMessage(body.error);
    } finally {
      setLoadingSlots(false);
    }
  }, [teacherTelegramId, kind, date]);

  const book = async (startsAt: string) => {
    if (!teacherTelegramId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cabinet/booking/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherTelegramId,
          kind,
          startsAt,
          groupId: kind === 'group' ? groupId ?? undefined : undefined,
        }),
      });
      const body = (await res.json()) as { error?: string; booking?: LessonBookingView };
      if (!res.ok) {
        throw new Error(body.error ?? 'Не удалось отправить заявку');
      }
      await refreshBookings();
      await loadSlots();
      setMessage('Заявка отправлена. Ожидайте подтверждения преподавателя.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/cabinet/booking/requests/${id}/cancel`, { method: 'POST' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось отменить');
      await refreshBookings();
      await loadSlots();
      setMessage('Заявка отменена.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (available <= 0 && remaining <= 0) {
    return (
      <section className="cab-panel cab-booking-block">
        <h3 className="cab-booking-title">Запись на занятие</h3>
        <p className="cab-note">У вас нет оплаченных {kind === 'individual' ? 'индивидуальных' : 'групповых'} занятий.</p>
        <a className="cab-btn cab-btn--join" href={paymentsHref}>
          Перейти к покупке
        </a>
      </section>
    );
  }

  if (!teacherTelegramId) {
    return (
      <section className="cab-panel cab-booking-block">
        <h3 className="cab-booking-title">Запись на занятие</h3>
        <p className="cab-note">Преподаватель ещё не назначен. Свяжитесь с наставником в Telegram.</p>
      </section>
    );
  }

  return (
    <section className="cab-panel cab-booking-block">
      <header className="cab-booking-head">
        <div>
          <h3 className="cab-booking-title">Запись на занятие</h3>
          <p className="cab-note">
            Осталось: <strong>{available}</strong> {kind === 'individual' ? 'индивидуальных' : 'групповых'} занятий
          </p>
        </div>
        <button type="button" className="cab-btn cab-btn--line" disabled={loadingSlots || busy} onClick={() => void loadSlots()}>
          Показать слоты
        </button>
      </header>

      {message ? <p className="cab-booking-msg">{message}</p> : null}

      <label className="cab-booking-date">
        Дата
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      {loadingSlots ? <p className="cab-note">Загрузка слотов…</p> : null}
      {!loadingSlots && slots.length > 0 ? (
        <ul className="cab-booking-slots">
          {slots.map((slot) => (
            <li key={slot.startsAt}>
              <span>{slot.label}</span>
              <button type="button" className="cab-btn cab-btn--join" disabled={busy || available <= 0} onClick={() => void book(slot.startsAt)}>
                Записаться
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pending.length > 0 ? (
        <div className="cab-booking-pending">
          <h4>Мои заявки</h4>
          <ul>
            {pending.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{formatDateTime(b.startsAt)}</strong>
                  <em>{statusLabel(b.status)}</em>
                </div>
                <button type="button" className="cab-btn cab-btn--line" disabled={busy} onClick={() => void cancel(b.id)}>
                  Отменить
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
