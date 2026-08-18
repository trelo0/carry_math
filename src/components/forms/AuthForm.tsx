'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { normalizePhone } from '@/lib/phone';

type Step = 'phone' | 'notlinked' | 'otp';

export default function AuthForm() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [normalized, setNormalized] = useState('');
  const [connectUrl, setConnectUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);
  const router = useRouter();

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
    const norm = normalizePhone(phone);
    if (!norm) {
      setMessage({ type: 'error', text: 'Формат номера: +375 29 123-45-67' });
      return;
    }
    setNormalized(norm);
    void requestCode(norm);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
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
      router.push('/account');
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
        <p className="auth-step-title">Telegram не подключён</p>
        <p className="signup-hint">
          Чтобы получать коды для входа, сначала подключите Telegram.
        </p>

        {connectUrl && (
          <a
            className="btn btn-primary auth-submit"
            href={connectUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Подключить Telegram
          </a>
        )}

        <button
          type="button"
          className="auth-secondary"
          disabled={loading}
          onClick={() => void requestCode(normalized)}
        >
          {loading ? 'Подожди…' : 'Я подключил — отправить код'}
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
        <p className="auth-step-title">Код отправлен в Telegram</p>

        <div className="signup-row">
          <label>
            Код из Telegram
            <input
              className="auth-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="······"
            />
          </label>
        </div>

        {message && (
          <p className={`signup-hint ${message.type === 'error' ? 'error' : 'ok'}`}>
            {message.text}
          </p>
        )}

        <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
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
      <div className="signup-row">
        <label>
          Номер телефона
          <input
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+375 29 123-45-67"
          />
        </label>
      </div>

      {message && (
        <p className={`signup-hint ${message.type === 'error' ? 'error' : 'ok'}`}>
          {message.text}
        </p>
      )}

      <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
        {loading ? 'Подожди…' : 'Получить код в Telegram'}
      </button>

      <p className="signup-hint">Вход без пароля — код придёт в Telegram-бот Math School.</p>
    </form>
  );
}
