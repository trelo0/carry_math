/** Стабильные ключи текстов бота (редактируются в Sanity → botSettings). */
export const BOT_COPY_KEYS = {
  guestWelcome: 'guest.welcome',
  guestWelcomeIdle: 'guest.welcome.client_idle',
  guestWelcomeActive: 'guest.welcome.client_active',
  guestCourseScreen: 'guest.course.screen',
  guestLessonsHub: 'guest.lessons.hub',
  guestLessonsIndividualBody: 'guest.lessons.individual.body',
  guestLessonsGroupBody: 'guest.lessons.group.body',
  guestLeadHeader: 'guest.lead.header',
  guestLeadStepName: 'guest.lead.step.name',
  guestLeadStepGrade: 'guest.lead.step.grade',
  guestLeadStepPreferredTeacher: 'guest.lead.step.preferred_teacher',
  guestLeadStepWishes: 'guest.lead.step.wishes',
  guestLeadStepContact: 'guest.lead.step.contact',
  guestSupportIntro: 'guest.support.intro',
} as const;

export type BotCopyKey = (typeof BOT_COPY_KEYS)[keyof typeof BOT_COPY_KEYS];

export const DEFAULT_BOT_COPY: Record<BotCopyKey, { title: string; body: string }> = {
  [BOT_COPY_KEYS.guestWelcome]: {
    title: 'Гость — приветствие /start',
    body:
      '👋 Добро пожаловать в онлайн-школу математики District!\n\n' +
      'Мы готовим к ЦТ/ЦЭ: онлайн-курс, индивидуальные и групповые занятия с опытными преподавателями.\n\n' +
      'Изучите форматы обучения в меню ниже и выберите, что вам подходит.',
  },
  [BOT_COPY_KEYS.guestWelcomeIdle]: {
    title: 'Клиент (student) без активных покупок — приветствие',
    body:
      '👋 С возвращением в District!\n\n' +
      'Сейчас нет активного курса или пакета занятий.\n\n' +
      'Посмотрите историю покупок и занятий в меню ниже или выберите новый формат обучения.',
  },
  [BOT_COPY_KEYS.guestWelcomeActive]: {
    title: 'Клиент с активным обучением — приветствие',
    body:
      '👋 District — ваше обучение\n\n' +
      'Выберите раздел в меню ниже: занятия, расписание, курс или новые программы.',
  },
  [BOT_COPY_KEYS.guestCourseScreen]: {
    title: 'Гость — экран «Онлайн-курс»',
    body:
      '🎓 Онлайн-курс District\n\n' +
      'Системная подготовка к ЦТ/ЦЭ по математике: вебинары, практика, домашние задания и поддержка куратора.\n\n' +
      'Подходит, если нужен понятный маршрут к экзамену без хаоса в материалах.\n\n' +
      'Оплата и доступ — на сайте школы; после покупки материалы открываются в личном кабинете.',
  },
  [BOT_COPY_KEYS.guestLessonsHub]: {
    title: 'Гость — «Занятия с преподавателем»',
    body:
      '👨‍🏫 Занятия с преподавателем\n\n' +
      'Живые занятия по математике с разбором тем и домашними заданиями.\n\n' +
      'Выберите формат — дальше покажем подробности и кнопку заявки.',
  },
  [BOT_COPY_KEYS.guestLessonsIndividualBody]: {
    title: 'Гость — описание индивидуальных',
    body: 'Занятия один на один: разбор тем, домашние задания, расписание под ученика.',
  },
  [BOT_COPY_KEYS.guestLessonsGroupBody]: {
    title: 'Гость — описание групповых',
    body: 'Небольшая группа, общий темп, занятия с преподавателем и поддержка куратора.',
  },
  [BOT_COPY_KEYS.guestLeadHeader]: {
    title: 'Заявка — заголовок шага',
    body: '📝 Заявка на занятия',
  },
  [BOT_COPY_KEYS.guestLeadStepName]: {
    title: 'Заявка — шаг «имя ученика»',
    body: 'Имя ученика\n\nНапишите имя или имя и фамилию одним сообщением.',
  },
  [BOT_COPY_KEYS.guestLeadStepGrade]: {
    title: 'Заявка — шаг «класс»',
    body: 'Класс\n\nНапример: 9, 10 или 11.',
  },
  [BOT_COPY_KEYS.guestLeadStepPreferredTeacher]: {
    title: 'Заявка — желаемый преподаватель (индивид.)',
    body: 'Желаемый преподаватель\n\nВыберите кнопкой ниже или напишите имя. Можно «Не важно».',
  },
  [BOT_COPY_KEYS.guestLeadStepWishes]: {
    title: 'Заявка — цель и пожелания',
    body: 'Цель и пожелания (необязательно)\n\nКратко опишите цель или нажмите «Пропустить».',
  },
  [BOT_COPY_KEYS.guestLeadStepContact]: {
    title: 'Заявка — контакт',
    body: 'Контакт (необязательно)\n\nТелефон или другой способ связи, либо «Пропустить».',
  },
  [BOT_COPY_KEYS.guestSupportIntro]: {
    title: 'Связаться с администратором',
    body:
      '🆘 Связаться с администратором\n\nОпишите вопрос одним сообщением — текст, фото или документ.',
  },
};
