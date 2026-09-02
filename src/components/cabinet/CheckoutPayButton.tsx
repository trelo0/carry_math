'use client';

import { useState } from 'react';
import ConsentCheckbox from '@/components/forms/ConsentCheckbox';

// Кнопка оплаты в кабинете: переход в Telegram-бот доступен только
// после согласия с политикой конфиденциальности.
export default function CheckoutPayButton({
  href,
  label = 'Перейти к оплате',
}: {
  href: string;
  label?: string;
}) {
  const [consent, setConsent] = useState(false);
  const locked = !consent;

  return (
    <div className="cab-checkout-consent">
      <ConsentCheckbox id="checkout-consent" checked={consent} onChange={setConsent} />

      <a
        className={`cab-checkout-pay${locked ? ' is-consent-locked' : ''}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={locked}
        tabIndex={locked ? -1 : undefined}
        onClick={(e) => {
          if (locked) e.preventDefault();
        }}
      >
        {label}
      </a>

      {locked && (
        <p className="consent-hint">
          Оплата станет доступна после принятия политики конфиденциальности.
        </p>
      )}
    </div>
  );
}
