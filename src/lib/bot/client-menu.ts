import type { ClientStateSnapshot, ClientUiPhase } from './client-state';

export const CLIENT_LABELS = {
  onlineCourse: '🎓 Онлайн-курс',
  lessonsWithTeacher: '👨‍🏫 Занятия с преподавателем',
  contactAdmin: '💬 Связаться с администратором',
  /** @deprecated используйте lessonsWithTeacher */
  buy: '👨‍🏫 Занятия с преподавателем',
  leaveRequest: '📝 Оставить заявку на занятия',
  myLessons: '📅 Мои занятия',
  schedule: '🗓 Расписание',
  myPackage: '📦 Мой пакет',
} as const;

export type ClientReplyLabel = (typeof CLIENT_LABELS)[keyof typeof CLIENT_LABELS];

const ALL_CLIENT_LABELS = new Set<string>(Object.values(CLIENT_LABELS));

export function isClientReplyLabel(text: string): text is ClientReplyLabel {
  return ALL_CLIENT_LABELS.has(text);
}

export type ClientReplyKeyboard = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: boolean;
};

const WELCOME: Record<ClientUiPhase, string> = {
  guest:
    '👋 Добро пожаловать в онлайн-школу математики District!\n\n' +
    'Мы готовим к ЦТ/ЦЭ: онлайн-курс, индивидуальные и групповые занятия с опытными преподавателями.\n\n' +
    'Изучите форматы обучения в меню ниже и выберите, что вам подходит.',
  client_idle:
    '👋 С возвращением в District!\n\n' +
    'Сейчас у вас нет активного обучения. Выберите формат обучения или посмотрите историю занятий.',
  client_active:
    '👋 District — ваше обучение\n\n' +
    'Выберите раздел в меню ниже: занятия, расписание, курс или новые программы.',
};

export function buildClientWelcomeText(state: ClientStateSnapshot, testFooter = ''): string {
  return WELCOME[state.phase] + testFooter;
}

export function buildClientReplyKeyboard(state: ClientStateSnapshot): ClientReplyKeyboard {
  const rows: Array<Array<{ text: string }>> = [];

  switch (state.phase) {
    case 'guest':
      rows.push(
        [{ text: CLIENT_LABELS.onlineCourse }],
        [{ text: CLIENT_LABELS.lessonsWithTeacher }],
      );
      break;
    case 'client_idle':
      rows.push(
        [{ text: CLIENT_LABELS.onlineCourse }],
        [{ text: CLIENT_LABELS.lessonsWithTeacher }],
      );
      if (state.hasLessonHistory) {
        rows.push([{ text: CLIENT_LABELS.myLessons }]);
      }
      if (state.hasUpcomingLessons) {
        rows.push([{ text: CLIENT_LABELS.schedule }]);
      }
      rows.push([{ text: CLIENT_LABELS.contactAdmin }]);
      break;
    case 'client_active':
      if (state.hasActiveLessonProduct || state.hasLessonHistory) {
        rows.push([{ text: CLIENT_LABELS.myLessons }]);
      }
      if (state.hasUpcomingLessons) {
        rows.push([{ text: CLIENT_LABELS.schedule }]);
      }
      if (state.hasActiveLessonProduct) {
        rows.push([{ text: CLIENT_LABELS.myPackage }]);
      }
      if (state.hasActiveCourse) {
        rows.push([{ text: CLIENT_LABELS.onlineCourse }]);
      }
      rows.push(
        [{ text: CLIENT_LABELS.lessonsWithTeacher }],
        [{ text: CLIENT_LABELS.contactAdmin }],
      );
      break;
  }

  return { keyboard: rows, resize_keyboard: true };
}
