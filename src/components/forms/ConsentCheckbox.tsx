'use client';

import type { ReactNode } from 'react';

type ConsentCheckboxProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: boolean;
  className?: string;
  label?: ReactNode;
};

// Единый чекбокс согласия с политикой конфиденциальности.
// Используется во всех формах записи и регистрации: без галочки
// действие (отправка формы / переход в Telegram) заблокировано.
export default function ConsentCheckbox({
  id,
  checked,
  onChange,
  error = false,
  className,
  label,
}: ConsentCheckboxProps) {
  return (
    <div
      className={['form-checkbox', 'consent-checkbox', error ? 'form-checkbox--error' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>
        {label ?? (
          <>
            Я согласен(на) на обработку персональных данных и принимаю{' '}
            <a
              href="/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              политику конфиденциальности
            </a>
          </>
        )}
      </label>
    </div>
  );
}
