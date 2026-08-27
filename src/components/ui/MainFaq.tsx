'use client';

import { useState } from 'react';

export type MainFaqItem = {
  q: string;
  a: string;
};

// Дефолтные вопросы: используются, пока в Sanity нет ни одного документа «Вопрос FAQ».
const DEFAULT_FAQ_ITEMS: MainFaqItem[] = [
  {
    q: 'Как проходят занятия онлайн?',
    a: 'Живые вебинары с экспертом 2 раза в неделю по ~90 минут плюс самостоятельная практика на геймифицированной платформе. Все записи занятий остаются у тебя навсегда.',
  },
  {
    q: 'Подойдёт ли формат, если я начинаю с нуля?',
    a: 'Да. На старте проводим диагностику и определяем точку А, а трек «Прокачка новичков» рассчитан на любой уровень — от «не знаю таблицу умножения» до уверенной базы.',
  },
  {
    q: 'Что будет, если я не успеваю за темпом?',
    a: 'Личный куратор следит за прогрессом и вовремя замечает просадку: подскажет, вернёт в темп и скорректирует план. Ты не остаёшься один на один с материалом.',
  },
  {
    q: 'Как быстро будет виден результат?',
    a: 'Первый заметный прогресс — через 3–4 недели регулярных занятий. Устойчивый рост баллов на пробниках — за 2–3 месяца системной подготовки.',
  },
  {
    q: 'Можно ли вернуть деньги, если не подойдёт?',
    a: 'Да. После первого занятия вернём 100% стоимости, если почувствуешь, что формат не твой, — без лишних вопросов.',
  },
  {
    q: 'Что нужно, чтобы начать?',
    a: 'Компьютер или планшет со стабильным интернетом и 3–4 часа в неделю. Всё остальное — платформа, материалы, шпаргалки и чек-листы — уже внутри.',
  },
];

export default function MainFaq({ items }: { items?: MainFaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const faqItems = items && items.length > 0 ? items : DEFAULT_FAQ_ITEMS;

  return (
    <div className="faq-list">
      {faqItems.map((item, index) => (
        <div
          className={`faq-item${open === index ? ' faq-item--open' : ''}`}
          key={item.q}
        >
          <button
            type="button"
            className="faq-head"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
          >
            <span className="faq-num">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="faq-q">{item.q}</span>
            <span className="faq-toggle" aria-hidden="true" />
          </button>
          <div className="faq-body">
            <div className="faq-body-inner">
              <p>{item.a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
