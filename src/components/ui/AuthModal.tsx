'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AuthForm from '@/components/forms/AuthForm';

// Модальное окно входа: телефон → код из Telegram (OTP).
// Сессия и редирект в кабинет — внутри AuthForm.
export default function AuthModal() {
  const { authOpen, closeAuth } = useAuth();

  useEffect(() => {
    if (!authOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuth();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [authOpen, closeAuth]);

  if (!authOpen) return null;

  return (
    <div className="modal-overlay open" onClick={closeAuth}>
      <div
        className="modal-content auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Вход в платформу"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-modal-header">
          <span className="webinar-logo-badge" aria-hidden="true">
            <span className="logo-icon" />
          </span>
          <div className="auth-modal-heading">
            <h2 className="auth-modal-title">Вход в платформу</h2>
            <span className="auth-modal-sub">Без пароля — по коду из Telegram</span>
          </div>
          <button className="webinar-close" onClick={closeAuth} aria-label="Закрыть">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="auth-modal-body">
          <AuthForm />
        </div>
      </div>
    </div>
  );
}
