'use client';

import { useState, ChangeEvent } from 'react';

interface ContactInputProps {
  name: string;
  placeholder?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  hasError?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export default function ContactInput({
  name,
  placeholder = '+375... или @username',
  value,
  onChange,
  required,
  hasError = false,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: ContactInputProps) {
  const [isTelegram, setIsTelegram] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;

    // Если есть буквы - это Telegram username
    if (/[a-zA-Z]/.test(val)) {
      setIsTelegram(true);
      // Если не начинается с @, добавляем
      if (!val.startsWith('@')) {
        val = '@' + val.replace(/@/g, '');
      }
      // Разрешаем только буквы, цифры и _
      val = '@' + val.slice(1).replace(/[^a-zA-Z0-9_]/g, '');
    } else if (val.startsWith('@')) {
      setIsTelegram(true);
      // Разрешаем только буквы, цифры и _
      val = '@' + val.slice(1).replace(/[^a-zA-Z0-9_]/g, '');
    } else {
      setIsTelegram(false);
      // Для телефона: оставляем только цифры и +
      val = val.replace(/[^\d+]/g, '');
      
      // Если начинается с 375 или +375, форматируем
      if (val.startsWith('+375') || val.startsWith('375')) {
        val = '+375' + val.replace(/^\+?375/, '');
        
        // Форматирование: +375 (XX) XXX-XX-XX
        const digits = val.slice(4);
        let formatted = '+375';
        if (digits.length > 0) {
          formatted += ' (' + digits.slice(0, 2);
        }
        if (digits.length > 2) {
          formatted += ') ' + digits.slice(2, 5);
        }
        if (digits.length > 5) {
          formatted += '-' + digits.slice(5, 7);
        }
        if (digits.length > 7) {
          formatted += '-' + digits.slice(7, 9);
        }
        val = formatted;
      }
    }

    // Создаём фейковое событие с изменённым значением
    const syntheticEvent = {
      ...e,
      target: {
        ...e.target,
        value: val,
        name,
      },
    } as ChangeEvent<HTMLInputElement>;

    onChange(syntheticEvent);
  };

  return (
    <div className="contact-input">
      <input
        type="text"
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        required={required}
        className={hasError ? 'error-input' : ''}
        autoComplete={isTelegram ? 'username' : 'tel'}
        inputMode={isTelegram ? 'text' : 'tel'}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
    </div>
  );
}
