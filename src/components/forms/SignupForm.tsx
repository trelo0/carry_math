'use client';

import { useState, FormEvent } from 'react';
import ContactInput from './ContactInput';

export default function SignupForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contact: '',
    comment: '',
    website: '',
  });

  const isValidContact = (value: string) => {
    const telegramRegex = /^@[a-zA-Z0-9_]{5,}$/;
    const phoneRegex = /^\+375\s?\(\d{2}\)\s?\d{3}-\d{2}-\d{2}$/;
    const simplePhoneRegex = /^[\d]{9,}$/;
    return telegramRegex.test(value) || phoneRegex.test(value) || simplePhoneRegex.test(value);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!isValidContact(formData.contact)) {
      setStatus('error');
      setErrorMessage('Введите телефон или Telegram (@username)');
      return;
    }

    setIsLoading(true);
    setStatus('idle');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          source: 'consultation',
        }),
      });

      await response.json();

      if (response.ok) {
        setStatus('success');
        setFormData({ name: '', contact: '', comment: '', website: '' });
      } else {
        setStatus('error');
        setErrorMessage('Не удалось отправить. Попробуйте ещё раз.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <form className="signup-form" id="signup-form" onSubmit={handleSubmit}>
      <input
        type="text"
        name="website"
        value={formData.website}
        onChange={handleChange}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
      />
      <div className="signup-row">
        <label>
          Имя
          <input
            type="text"
            name="name"
            placeholder="Ваше имя"
            value={formData.name}
            onChange={handleChange}
            required
            autoComplete="name"
          />
        </label>
      </div>
      <div className="signup-row">
        <label>
          Контакт (телефон или Telegram)
          <ContactInput
            name="contact"
            placeholder="+375... или @username"
            value={formData.contact}
            onChange={handleChange}
            required
            aria-invalid={status === 'error' ? true : undefined}
            aria-describedby={status === 'error' ? 'signup-contact-error' : undefined}
          />
        </label>
        {status === 'error' && (
          <span className="signup-hint error" id="signup-contact-error">
            {errorMessage ?? 'Проверьте контакт'}
          </span>
        )}
      </div>
      <div className="signup-row">
        <label>
          Комментарий (необязательно)
          <textarea
            name="comment"
            placeholder="Пожелания, вопросы, удобный время для занятий..."
            value={formData.comment}
            onChange={handleChange}
            rows={3}
            autoComplete="off"
          />
        </label>
      </div>
      <button
        type="submit"
        className="btn btn-primary signup-submit"
        disabled={isLoading}
      >
        {isLoading ? 'Отправка...' : 'Отправить заявку'}
      </button>
      {status === 'success' && (
        <p className="signup-note success">
          ✅ Заявка успешно отправлена!
        </p>
      )}
    </form>
  );
}
