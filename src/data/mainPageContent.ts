// Контент страницы курса (/), управляемый через Sanity.
// Все поля опциональны: если данных в Sanity нет (или поле пустое),
// используется дефолт из этого файла — страница всегда наполнена.

export type MainHeroContent = {
  eyebrow?: string;
  headline?: string;
  pills?: string[];
  questTitle?: string;
  questNote?: string;
  questPoints?: string[];
  buttonText?: string;
};

export type MentorSpec = { label: string; value: number };
export type MentorJournalItem = { title: string; text: string };

export type MentorBlockContent = {
  sectionTitle?: string;
  specs?: MentorSpec[];
  journal?: MentorJournalItem[];
  mentorName?: string;
  mentorClass?: string;
  mentorLevel?: string;
  badges?: string[];
  quoteStatus?: string;
  quoteText?: string;
};

export type MissionItem = { title: string; text: string };

export type ProgramBlockContent = {
  sectionTitle?: string;
  missions?: MissionItem[];
};

export type ReviewsBlockContent = {
  sectionTitle?: string;
};

export type InitStepItem = {
  icon?: string;
  title: string;
  lines: string[];
};

export type InitBlockContent = {
  sectionTitle?: string;
  subtitle?: string;
  steps?: InitStepItem[];
  priceLabel?: string;
  priceValue?: string;
  pricePeriod?: string;
  priceNote?: string;
  buttonText?: string;
};

export type FaqItemContent = { question: string; answer: string };

export type FaqBlockContent = {
  sectionTitle?: string;
};

export type PathColumn = {
  title: string;
  sub?: string;
  description?: string;
  perks: string[];
};

export type PathsBlockContent = {
  sectionTitle?: string;
  columns?: PathColumn[];
  ctaText?: string;
};

export type MainPageContent = {
  hero?: MainHeroContent;
  mentor?: MentorBlockContent;
  program?: ProgramBlockContent;
  reviews?: ReviewsBlockContent;
  init?: InitBlockContent;
  faq?: FaqBlockContent;
  faqItems?: FaqItemContent[];
  paths?: PathsBlockContent;
};

// ---------- Дефолты: текущие статические тексты страницы ----------

export const MAIN_PAGE_DEFAULTS = {
  hero: {
    eyebrow: 'Онлайн-школа по математике',
    headline: 'Готовим победителей',
    pills: ['Живые вебинары', 'Геймифицированная платформа', 'Личный куратор'],
    questTitle: 'Здесь подготовка - это квест',
    questNote: 'Ты не просто учишь формулы, ты:',
    questPoints: [
      'Открываешь секретные коды фракций',
      'Прокачиваешь личный прогресс на карте',
      'Общаешься с наставником в закрытом ТГ-канале',
    ],
    buttonText: 'Записаться',
  },
  mentor: {
    sectionTitle: 'Твой наставник по математике',
    specs: [
      { label: 'Харизма и удержание внимания', value: 98 },
      { label: 'Взлом ЦТ / декодирование информации', value: 100 },
      { label: 'Ментальная стойкость', value: 95 },
      { label: 'Прокачка новичков', value: 92 },
      { label: 'Индекс занудства', value: 4 },
      { label: 'Синхронизация (понятный язык)', value: 99 },
    ] as MentorSpec[],
    journal: [
      {
        title: 'Год инициации в системе (опыт)',
        text: 'Преподавательский стаж 4 года',
      },
      {
        title: 'Базовый сектор подготовки (образование)',
        text: '2019 — лицей №2, физмат профиль\n2023 — БГУ, механико-математический факультет, специальность: математика [научно-педагогическая деятельность]',
      },
      {
        title: 'Главный боевой трофей (результат)',
        text: 'Личный результат: 98 баллов ЦТ',
      },
    ] as MentorJournalItem[],
    mentorName: 'Лидия Владимировна',
    mentorClass: 'Наставник гильдии',
    mentorLevel: 'LVL 99 · МАТЕМАТИКА',
    badges: ['98 баллов ЦТ', '4 года опыта', 'БГУ, мехмат'],
    quoteStatus: '[Наставник гильдии online. Сектор MM-01]',
    quoteText:
      'Математика — это четкая архитектура. Я научу твой мозг видеть скрытые ловушки составителей тестов за три секунды. Экзамен — это просто финальный босс, которого мы обязаны пройти на максимум.',
  },
  program: {
    sectionTitle: 'Программа обучения',
    missions: [
      { title: 'Диагностика', text: 'Определяем уровень, цели и точки роста.' },
      { title: 'Личный план', text: 'Собираем программу под твои задачи.' },
      { title: 'Практика', text: 'Решаем реальные варианты ЕГЭ и олимпиад.' },
      { title: 'Контроль', text: 'Срезы, разбор ошибок и отчёты родителям.' },
      { title: 'Победа', text: 'Выходим на экзамен подготовленным на 100%.' },
    ] as MissionItem[],
  },
  reviews: {
    sectionTitle: 'Отзывы',
  },
  init: {
    sectionTitle: 'Время пройти инициацию',
    subtitle: 'Полноценный абонемент на месяц',
    steps: [
      {
        icon: 'search',
        title: '8 занятий с экспертом',
        lines: [
          '2 раза в неделю',
          '1 занятие ~90 минут',
          'Разбор ловушек ЦТ в режиме реального времени',
          'Решаем только то, что реально будет на ЦТ',
        ],
      },
      {
        icon: 'pencil',
        title: 'Ручная проверка домашних заданий',
        lines: [
          'Поддержка, мотивация и контроль 24/7',
          'Личный куратор в Telegram с развернутыми комментариями к домашнему заданию — он разбирает каждую твою ошибку',
        ],
      },
      {
        icon: 'sliders',
        title: 'Доступ к интерактивной платформе',
        lines: ['Улица Дистрикта с визуализацией твоего прогресса'],
      },
      {
        icon: 'chart',
        title: 'Оружейная комната',
        lines: ['Шпаргалки, чек-листы и материалы по всем темам ЦТ'],
      },
    ] as InitStepItem[],
    priceLabel: 'Стоимость',
    priceValue: '180 BYN',
    pricePeriod: 'за один месяц подготовки',
    priceNote: '100% возврат после первого занятия, если формат не подошёл',
    buttonText: 'Записаться на курс',
  },
  faq: {
    sectionTitle: 'Часто задаваемые вопросы',
  },
  faqItems: [
    {
      question: 'Как проходят занятия онлайн?',
      answer:
        'Живые вебинары с экспертом 2 раза в неделю по ~90 минут плюс самостоятельная практика на геймифицированной платформе. Все записи занятий остаются у тебя навсегда.',
    },
    {
      question: 'Подойдёт ли формат, если я начинаю с нуля?',
      answer:
        'Да. На старте проводим диагностику и определяем точку А, а трек «Прокачка новичков» рассчитан на любой уровень — от «не знаю таблицу умножения» до уверенной базы.',
    },
    {
      question: 'Что будет, если я не успеваю за темпом?',
      answer:
        'Личный куратор следит за прогрессом и вовремя замечает просадку: подскажет, вернёт в темп и скорректирует план. Ты не остаёшься один на один с материалом.',
    },
    {
      question: 'Как быстро будет виден результат?',
      answer:
        'Первый заметный прогресс — через 3–4 недели регулярных занятий. Устойчивый рост баллов на пробниках — за 2–3 месяца системной подготовки.',
    },
    {
      question: 'Можно ли вернуть деньги, если не подойдёт?',
      answer:
        'Да. После первого занятия вернём 100% стоимости, если почувствуешь, что формат не твой, — без лишних вопросов.',
    },
    {
      question: 'Что нужно, чтобы начать?',
      answer:
        'Компьютер или планшет со стабильным интернетом и 3–4 часа в неделю. Всё остальное — платформа, материалы, шпаргалки и чек-листы — уже внутри.',
    },
  ] as FaqItemContent[],
  paths: {
    sectionTitle: 'Не подошёл курс?',
    columns: [
      {
        title: 'Одиночный рейд',
        sub: 'Индивидуальные занятия с наставником 5–11 класс',
        description:
          'Личный маршрут по математике: программа, темп и фокус — только под тебя. Наставник ведёт от диагностики до экзамена.',
        perks: [
          'Программа строится под твою цель и стартовый уровень',
          'Гибкий график — занятия когда удобно, даже вечером',
          'Максимальное внимание наставника всё занятие',
          'Личный куратор и разбор каждой ошибки 24/7',
        ],
      },
      {
        title: 'Командный сектор',
        sub: 'Занятия в мини-группах до 5-ти человек 5–10 класс',
        description:
          'Мини-отряд до 5 человек: общий рейтинг, командные квесты и дух соревнования — мотивация, которой не хватает в одиночку.',
        perks: [
          'Цена ниже, качество подготовки то же',
          'Командный рейтинг и совместные квесты',
          'Игровая мотивация: уровни, лиги, награды',
          'Занятия в мини-группе до 5 человек',
        ],
      },
    ] as PathColumn[],
    ctaText: 'Узнать больше',
  },
} satisfies Required<MainPageContent>;

// ---------- Хелперы подстановки с дефолтами ----------

/** Строка из Sanity, если она непустая; иначе дефолт. */
export function pickStr(value: string | null | undefined, fallback: string): string {
  return value && value.trim() ? value : fallback;
}

/** Массив из Sanity, если он непустой; иначе дефолт. */
export function pickArr<T>(value: T[] | null | undefined, fallback: T[]): T[] {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

/** Число из Sanity, если оно задано; иначе дефолт. */
export function pickNum(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
