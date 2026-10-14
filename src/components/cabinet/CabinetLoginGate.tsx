'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/** Ждёт сессию и открывает модалку входа (без отдельной «страницы логина»). */
export default function CabinetLoginGate({
  returnTo,
}: {
  returnTo: string;
  title?: string;
}) {
  const { openAuth, phone, loading, authOpen } = useAuth();
  const reloadedForSession = useRef(false);

  useLayoutEffect(() => {
    if (!loading && !phone) openAuth(returnTo);
  }, [loading, openAuth, phone, returnTo]);

  useLayoutEffect(() => {
    if (loading || !phone || reloadedForSession.current) return;
    reloadedForSession.current = true;
    window.location.assign(returnTo);
  }, [loading, phone, returnTo]);

  if (loading || authOpen || phone) {
    return <div className="cabinet cab-auth-backdrop" aria-busy="true" aria-label="Вход в кабинет" />;
  }

  return (
    <div className="cabinet">
      <div className="cab-main cab-tg-gate-wrap">
        <section className="cab-panel cab-tg-gate cab-auth-dismissed">
          <p>Чтобы открыть кабинет, войди по номеру телефона.</p>
          <button type="button" className="cab-btn cab-btn--join" onClick={() => openAuth(returnTo)}>
            Войти
          </button>
          <Link href="/" className="cab-tg-gate-back">
            На главную
          </Link>
        </section>
      </div>
    </div>
  );
}
