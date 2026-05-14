'use client';

import { useState, FormEvent } from 'react';
import { useForm } from '@/contexts/FormContext';
import ContactInput from './ContactInput';

export default function SignupModalForm() {
  const { formData, closeForm } = useForm();
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errors, setErrors] = useState<{[key: string]: boolean}>({});
  const [fields, setFields] = useState({
    name: '',
    contact: '',
    grade: '',
    rtScore: '',
    comment: '',
    website: '',
  });

  const isValidContact = (value: string) => {
    const telegramRegex = /^@[a-zA-Z0-9_]{5,}$/;
    const phoneRegex = /^\+375\s?\(\d{2}\)\s?\d{3}-\d{2}-\d{2}$/;
    const simplePhoneRegex = /^[\d]{9,}$/;
    return telegramRegex.test(value) || phoneRegex.test(value) || simplePhoneRegex.test(value);
  };

  const validateFields = () => {
    const newErrors: {[key: string]: boolean} = {};
    
    if (!fields.name.trim()) {
      newErrors.name = true;
    }
    
    if (!fields.contact.trim()) {
      newErrors.contact = true;
    } else if (!isValidContact(fields.contact)) {
      newErrors.contact = true;
    }
    
    if (!fields.grade.trim()) {
      newErrors.grade = true;
    }

    // Проверяем балл РТ только для 10-11 классов
    if ((fields.grade === '10' || fields.grade === '11') && !fields.rtScore.trim()) {
      newErrors.rtScore = true;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!validateFields()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: fields.name,
          contact: fields.contact,
          grade: fields.grade,
          rtScore: fields.rtScore,
          comment: fields.comment,
          website: fields.website,
          teacher: formData?.teacher,
          service: formData?.service,
          price: formData?.price,
          waitlist: formData?.waitlist,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setFields({ name: '', contact: '', grade: '', rtScore: '', comment: '', website: '' });
        setErrors({});
        setTimeout(() => {
          closeForm();
        }, 2000);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // Сбрасываем ошибку при изменении поля
    if (errors[name]) {
      setErrors({ ...errors, [name]: false });
    }

    // Для числовых полей применяем ограничения
    if (name === 'grade') {
      const numericValue = value.replace(/\D/g, '');
      const numValue = Number(numericValue);
      
      // Ограничение: 1-11
      if (numericValue === '' || (numValue >= 1 && numValue <= 11)) {
        setFields({ ...fields, grade: numericValue });
        
        // Сбрасываем балл РТ если класс не 10-11
        if (numericValue !== '10' && numericValue !== '11') {
          setFields({ ...fields, grade: numericValue, rtScore: '' });
          if (errors.rtScore) {
            setErrors({ ...errors, rtScore: false });
          }
        }
      }
      return;
    }

    if (name === 'rtScore') {
      const numericValue = value.replace(/\D/g, '');
      const numValue = Number(numericValue);
      
      // Ограничение: 0-100
      if (numericValue === '' || (numValue >= 0 && numValue <= 100)) {
        setFields({ ...fields, rtScore: numericValue });
      }
      return;
    }

    setFields({ ...fields, [name]: value });
  };

  return (
    <form className="modal-form" onSubmit={handleSubmit}>
      <div className="modal-header">
        <h2 className="modal-title">Запись на занятие</h2>
        <button className="modal-close" onClick={closeForm} aria-label="Закрыть">
          ×
        </button>
      </div>

      <div className="modal-body">
        <input
          type="text"
          name="website"
          value={fields.website}
          onChange={handleChange}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
        />
        {formData && (
          <div className="booking-info">
            <div className="booking-row">
              <span className="booking-label">Преподаватель:</span>
              <span className="booking-value">{formData.teacher}</span>
            </div>
            <div className="booking-row">
              <span className="booking-label">Пробное занятие:</span>
              <span className="booking-price">{formData.price}</span>
            </div>
          </div>
        )}

        <div className="modal-row">
          <label htmlFor="name">Имя</label>
          <input
            id="name"
            type="text"
            name="name"
            placeholder="Ваше имя"
            value={fields.name}
            onChange={handleChange}
            className={errors.name ? 'error-input' : ''}
          />
        </div>

        <div className="modal-row">
          <label htmlFor="contact">Контакт</label>
          <ContactInput
            name="contact"
            placeholder="viber/telegram"
            value={fields.contact}
            onChange={handleChange}
            hasError={errors.contact}
          />
        </div>

        <div className="modal-row">
          <label htmlFor="grade">Класс</label>
          <input
            id="grade"
            type="text"
            name="grade"
            placeholder="1-11"
            value={fields.grade}
            onChange={handleChange}
            className={errors.grade ? 'error-input' : ''}
            inputMode="numeric"
          />
        </div>

        {(fields.grade === '10' || fields.grade === '11') && (
          <div className="modal-row">
            <label htmlFor="rtScore">Балл РТ</label>
            <input
              id="rtScore"
              type="text"
              name="rtScore"
              placeholder="0-100"
              value={fields.rtScore}
              onChange={handleChange}
              className={errors.rtScore ? 'error-input' : ''}
              inputMode="numeric"
            />
          </div>
        )}

        <div className="modal-row">
          <label htmlFor="comment">Комментарий</label>
          <textarea
            id="comment"
            name="comment"
            placeholder="Пожелания, вопросы..."
            value={fields.comment}
            onChange={handleChange}
            rows={2}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary modal-submit"
          disabled={isLoading}
        >
          {isLoading ? 'Отправка...' : 'Отправить заявку'}
        </button>

        {status === 'success' && (
          <p className="modal-note success">
            ✅ Заявка успешно отправлена!
          </p>
        )}

        {status === 'error' && (
          <p className="modal-note error">
            ❌ Ошибка при отправке. Попробуйте ещё раз
          </p>
        )}
      </div>
    </form>
  );
}
