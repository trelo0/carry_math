'use client';

import { useState } from 'react';
import ConsentCheckbox from '@/components/forms/ConsentCheckbox';

// Официальный контур логотипа Telegram (simple-icons, viewBox 24x24).
export function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// Карточка записи на бесплатный вебинар через Telegram.
// Используются во всплывающем окне при входе и в сообщении вместо курса.
export function WebinarSignupOptions({ onChoose }: { onChoose?: () => void }) {
  // Переход в Telegram для записи доступен только после согласия с политикой.
  const [consent, setConsent] = useState(false);
  const locked = !consent;

  // Deep link: бот по «/start webinar» сразу открывает гостевое главное меню.
  const telegramUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
    ? `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}?start=webinar`
    : '';

  return (
    <div className="webinar-popup-options">
      

      {telegramUrl ? (
        <a
          className={`webinar-option webinar-option--telegram${locked ? ' is-consent-locked' : ''}`}
          href={telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={locked}
          tabIndex={locked ? -1 : undefined}
          onClick={(e) => {
            if (locked) {
              e.preventDefault();
              return;
            }
            onChoose?.();
          }}
        >
          <span className="webinar-option-inner">
            <span className="webinar-option-icon webinar-option-icon--telegram" aria-hidden="true">
              <TelegramIcon />
            </span>
            <span className="webinar-option-copy">
              <b>Telegram</b>
              <span className="webinar-option-line">Записаться через Telegram</span>
              <small>Быстрая регистрация через нашего бота</small>
            </span>
            <span className="webinar-option-arrow" aria-hidden="true">→</span>
          </span>
        </a>
      ) : null}

    <ConsentCheckbox
        id="webinar-consent"
        className="webinar-consent"
        checked={consent}
        onChange={setConsent}
      />
    </div>
  );
}
