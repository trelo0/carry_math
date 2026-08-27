// Контент страницы «Индивидуальные занятия» (/individual), управляемый через Sanity.
// Все поля опциональны: если данных в Sanity нет (или поле пустое),
// используется дефолт из этого файла — страница всегда наполнена.

export type HeroSlotItem = {
  icon?: string;
  title: string;
  sub?: string;
  href?: string;
};

export type IndividualHeroContent = {
  kicker?: string;
  title?: string;
  description?: string;
  panelTitle?: string;
  slots?: HeroSlotItem[];
};

export type TeachersBlockContent = {
  kicker?: string;
  sectionTitle?: string;
  badges?: string[];
};

export type PrinciplesBlockContent = {
  kicker?: string;
  sectionTitle?: string;
  sectionSubtitle?: string;
};

export type FormatColumn = {
  icon?: string;
  title: string;
  sub?: string;
  description?: string;
  perks: string[];
  ctaText?: string;
};

export type FormatsBlockContent = {
  kicker?: string;
  sectionTitle?: string;
  columns?: FormatColumn[];
};

export type ProcessBlockContent = {
  kicker?: string;
  sectionTitle?: string;
  sectionSubtitle?: string;
};

export type BenefitItem = { title: string; text: string };

export type ChoosePathBlockContent = {
  kicker?: string;
  sectionTitle?: string;
  sectionTitleGold?: string;
  soloTabText?: string;
  groupTabText?: string;
  trialGuideTitle?: string;
  trialGuideText?: string;
  benefits?: BenefitItem[];
};

export type DiagnosticStepItem = { title: string; text: string };

export type DiagnosticBlockContent = {
  eyebrow?: string;
  title?: string;
  text?: string;
  buttonText?: string;
  steps?: DiagnosticStepItem[];
};

export type IndividualPageContent = {
  hero?: IndividualHeroContent;
  teachers?: TeachersBlockContent;
  principles?: PrinciplesBlockContent;
  formats?: FormatsBlockContent;
  process?: ProcessBlockContent;
  choosePath?: ChoosePathBlockContent;
  diagnostic?: DiagnosticBlockContent;
};

// ---------- Дефолты: текущие статические тексты страницы ----------

export const INDIVIDUAL_PAGE_DEFAULTS = {
  hero: {
    kicker: 'ФОРМАТЫ ЗАНЯТИЙ // 5–11 КЛАСС',
    title: 'Занятия с наставником гильдии',
    description:
      'Индивидуальные уроки один на один с наставником и мини-группы до 5 человек — выбери свой формат и идём к цели вместе.',
    panelTitle: 'Выбор пути',
    slots: [
      { icon: '🗡', title: 'Одиночный рейд', sub: 'индивидуальные · 5–11 класс', href: '#formats-solo' },
      { icon: '🛡', title: 'Командный сектор', sub: 'мини-группы до 5 · 5–10 класс', href: '#formats-group' },
    ] as HeroSlotItem[],
  },
  teachers: {
    kicker: 'КВЕСТ 01 // ОТРЯД ГИЛЬДИИ :: SELECT',
    sectionTitle: 'Выбери наставника',
    badges: ['98 баллов ЦТ', '4 года опыта', 'БГУ, мехмат'],
  },
  principles: {
    kicker: 'КВЕСТ 02 // СТАТИСТИКА + ПРИНЦИПЫ :: CODE',
    sectionTitle: 'Принципы гильдии',
    sectionSubtitle: '',
  },
  formats: {
    kicker: 'КВЕСТ 03 // ВАРИАНТЫ ЗАНЯТИЙ :: VS MODE',
    sectionTitle: 'Соло или команда?',
    columns: [
      {
        icon: '🗡',
        title: 'Одиночный рейд',
        sub: 'индивидуальные · 5–11 класс',
        description:
          'Личный маршрут по математике: программа, темп и фокус — только под тебя. Наставник ведёт от диагностики до экзамена.',
        perks: [
          'Программа строится под твою цель и стартовый уровень',
          'Гибкий график — занятия когда удобно, даже вечером',
          'Максимальное внимание наставника всё занятие',
          'Личный куратор и разбор каждой ошибки 24/7',
        ],
        ctaText: 'Записаться на соло',
      },
      {
        icon: '🛡',
        title: 'Командный сектор',
        sub: 'мини-группы до 5 · 5–10 класс',
        description:
          'Мини-отряд единомышленников: общий рейтинг, командные квесты и дух соревнования. Качество то же, цена ниже.',
        perks: [
          'Цена ниже, качество подготовки то же',
          'Командный рейтинг и совместные квесты',
          'Игровая мотивация: уровни, лиги, награды',
          'Занятия в мини-группе до 5 человек',
        ],
        ctaText: 'Записаться в группу',
      },
    ] as FormatColumn[],
  },
  process: {
    kicker: 'КВЕСТ 04 // КАК ПРОХОДИТ ОБУЧЕНИЕ :: ПРОТОКОЛ',
    sectionTitle: 'Как проходит обучение',
    sectionSubtitle: '',
  },
  choosePath: {
    kicker: 'КВЕСТ 05 // ЗАПИСЬ :: START QUEST',
    sectionTitle: 'Время выбрать',
    sectionTitleGold: 'свой путь',
    soloTabText: '🗡 Одиночный рейд',
    groupTabText: '🛡 Командный сектор',
    trialGuideTitle: 'Пробное занятие — первый шаг',
    trialGuideText:
      'Пробное занятие необходимо для начала индивидуальных занятий.\nОно поможет определить уровень и подобрать подходящую программу.',
    benefits: [
      { title: 'Профессиональные', text: 'опытные преподаватели' },
      { title: 'Индивидуальный подход', text: 'программа под ваши цели' },
      { title: 'Удобный график', text: 'занимайтесь в комфортное время' },
    ] as BenefitItem[],
  },
  diagnostic: {
    eyebrow: 'Диагностика способностей',
    title: 'В чём твоя сильная сторона?',
    text: 'Авторская диагностика подберёт направление под твой стиль мышления. Без подготовки и «правильных ответов» — только твои реальные способности.',
    buttonText: 'Пройти диагностику',
    steps: [
      {
        title: 'Диагностика',
        text: '15 минут интерактивной симуляции определяют твои сильные стороны.',
      },
      {
        title: 'Выбор направления',
        text: 'Результат — персональная рекомендация. Финальное решение за тобой.',
      },
      {
        title: 'Старт подготовки',
        text: 'Работа с наставником, с которым реальный прогресс в подготовке.',
      },
    ] as DiagnosticStepItem[],
  },
} satisfies Required<IndividualPageContent>;
