'use client';

import { useEffect, useState } from 'react';
import WebinarSignupPanel from './WebinarSignupPanel';

const SEEN_KEY = 'district-webinar-popup-seen';

// Всплывающее окно при входе на сайт: запись на бесплатный вебинар.
// Вариант записи — Telegram. Показывается один раз за сессию
// с небольшой задержкой после загрузки.
export default function WebinarEntryPopup() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch {
      // Приватный режим и т.п. — показываем попап без отметки.
    }

    const timer = window.setTimeout(() => setVisible(true), 800);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const close = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Отметка недоступна — попап просто закрывается.
    }
  };

  return (
    <div className="modal-overlay open" onClick={close}>
      <div
        className="modal-content webinar-popup"
        role="dialog"
        aria-modal="true"
        aria-label="Запись на бесплатный вебинар"
        onClick={(e) => e.stopPropagation()}
      >
        <WebinarSignupPanel variant="entry" onClose={close} />
      </div>
    </div>
  );
}
