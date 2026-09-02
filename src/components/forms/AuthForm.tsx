'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { normalizePhone, formatPhoneInput } from '@/lib/phone';
import { AUTH_CHANGED_EVENT } from '@/contexts/AuthContext';
import { TelegramIcon } from '@/components/ui/WebinarSignupOptions';
import ConsentCheckbox from '@/components/forms/ConsentCheckbox';

type Step = 'phone' | 'notlinked' | 'otp';

function PhoneIcon() {
  return (
    <svg className="auth-field-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="auth-field-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.75 3.5 5v6.09c0 5.26 3.63 10.18 8.5 11.16 4.87-.98 8.5-5.9 8.5-11.16V5L12 1.75zm-1.25 14.5-3.5-3.5 1.41-1.41 2.09 2.08 5.09-5.08 1.41 1.41-6.5 6.5z" />
    </svg>
  );
}

// Индикатор шагов: 1 — номер, 2 — код из Telegram.
function AuthSteps({ current }: { current: 1 | 2 }) {
  return (
    <div className="auth-steps" aria-hidden="true">
      <span className={`auth-step${current === 1 ? ' auth-step--active' : ' auth-step--done'}`}>
        1 · номер
      </span>
      <span className="auth-steps-line" />
      <span className={`auth-step${current === 2 ? ' auth-step--active' : ''}`}>2 · код</span>
    </div>
  );
}

export default function AuthForm() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [normalized, setNormalized] = useState('');
  const [connectUrl, setConnectUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);
  const router = useRouter();

  // Ошибка относится к полю: красим рамку и пишем текст сразу под ним.
  const fieldError = message?.type === 'error' ? message.text : null;

  const requestCode = async (phoneValue: string) => {
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneValue }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: data?.error ?? 'Что-то пошло не так. Попробуй ещё раз.' });
        return;
      }
      if (data.status === 'not_linked') {
        setConnectUrl(data.connectUrl ?? '');
        setStep('notlinked');
        setMessage(null);
      } else {
        setStep('otp');
        setCode('');
        setMessage({ type: 'ok', text: 'Мы отправили код в Telegram-бот Math School.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Не удалось связаться с сервером. Попробуй ещё раз.' });
    } finally {
      setLoading(false);
    }
  };

  const handlePhone = (e: FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setMessage({ type: 'error', text: 'Введите номер телефона.' });
      return;
    }
    const norm = normalizePhone(phone);
    if (!norm) {
      setMessage({
        type: 'error',
        text: 'Формат номера: +375 (29) 123-45-67 или 80(29)123-45-67',
      });
      return;
    }
    if (!consent) {
      setMessage({
        type: 'error',
        text: 'Необходимо принять политику конфиденциальности.',
      });
      return;
    }
    setNormalized(norm);
    void requestCode(norm);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!code) {
      setMessage({ type: 'error', text: 'Введите код из Telegram.' });
      return;
    }
    if (code.length !== 6) {
      setMessage({ type: 'error', text: 'Код состоит из 6 цифр.' });
      return;
    }
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: data?.error ?? 'Что-то пошло не так. Попробуй ещё раз.' });
        return;
      }
      // Шапка и другие компоненты узнают о входе без перезагрузки.
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      router.push('/cabinet');
      router.refresh();
    } catch {
      setMessage({ type: 'error', text: 'Не удалось связаться с сервером. Попробуй ещё раз.' });
    } finally {
      setLoading(false);
    }
  };

  const backToPhone = () => {
    setStep('phone');
    setCode('');
    setMessage(null);
  };

  if (step === 'notlinked') {
    return (
      <div className="auth-form">
        <AuthSteps current={2} />

        <div className="auth-tg-card">
          <span className="auth-tg-card-icon" aria-hidden="true">
            <TelegramIcon />
          </span>
          <div className="auth-tg-card-copy">
            <b>Telegram не подключён</b>
            <p>
              К этому номеру пока не привязан Telegram-бот — а коды для входа
              приходят именно туда. Подключи бота и возвращайся.
            </p>
          </div>
        </div>

        {connectUrl && (
          <a
            className="btn btn-gold auth-submit"
            href={connectUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <TelegramIcon />
            Подключить Telegram
          </a>
        )}

        <button
          type="button"
          className="btn auth-linked"
          disabled={loading}
          onClick={() => void requestCode(normalized)}
        >
          {loading ? 'Отправляем…' : 'Я подключил — отправить код'}
        </button>

        <button type="button" className="auth-back" onClick={backToPhone}>
          ← Изменить номер
        </button>
      </div>
    );
  }

  if (step === 'otp') {
    return (
      <form className="auth-form" onSubmit={handleVerify}>
        <AuthSteps current={2} />

        <p className="auth-otp-phone">
          Код отправлен на номер <b>{phone || normalized}</b>
        </p>

        <label className="auth-field">
          <span className="auth-field-label">Код из Telegram</span>
          <span className="auth-field-box">
            <ShieldIcon />
            <input
              className={`auth-otp${fieldError ? ' auth-input--error' : ''}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                if (message) setMessage(null);
              }}
              placeholder="······"
            />
          </span>
        </label>

        {message && <p className={`auth-message ${message.type}`}>{message.text}</p>}

        <button className="btn btn-gold auth-submit" type="submit" disabled={loading}>
          {loading ? 'Подожди…' : 'Войти'}
        </button>

        <button
          type="button"
          className="auth-secondary"
          disabled={loading}
          onClick={() => void requestCode(normalized)}
        >
          Отправить код повторно
        </button>

        <button type="button" className="auth-back" onClick={backToPhone}>
          ← Изменить номер
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={handlePhone}>
      <AuthSteps current={1} />

      <label className="auth-field">
        <span className="auth-field-label">Номер телефона</span>
        <span className="auth-field-box">
          <PhoneIcon />
          <input
            type="tel"
            autoComplete="tel"
            className={fieldError ? 'auth-input--error' : undefined}
            value={phone}
            onChange={(e) => {
              setPhone(formatPhoneInput(e.target.value));
              if (message) setMessage(null);
            }}
            placeholder="+375 (29) 123-45-67"
          />
        </span>
      </label>

      {message && <p className={`auth-message ${message.type}`}>{message.text}</p>}

      <ConsentCheckbox
        id="auth-consent"
        className="auth-consent"
        checked={consent}
        onChange={(checked) => {
          setConsent(checked);
          if (message) setMessage(null);
        }}
      />

      <button className="btn btn-gold auth-submit" type="submit" disabled={loading || !consent}>
        {loading ? 'Подожди…' : 'Получить код в Telegram'}
      </button>

    </form>
  );
}
