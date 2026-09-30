import type { ClientStateSnapshot, ClientUiPhase } from './client-state';

export const CLIENT_LABELS = {
  onlineCourse: '🎓 Онлайн-курс',
  leaveRequest: '📝 Оставить заявку на занятия',
  contactAdmin: '💬 Связаться с администратором',
  buy: '💳 Купить обучение',
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
    'Привет! Я бот онлайн-школы математики District.\n\n' +
    'Здесь можно узнать об обучении, оставить заявку на занятия или связаться с администратором.',
  client_idle:
    'Меню клиента\n\n' +
    'Сейчас нет активного обучения. Вы можете купить программу, оставить заявку или посмотреть историю занятий.',
  client_active:
    'Меню клиента\n\n' +
    'Выберите раздел в меню ниже. Состав кнопок зависит от ваших активных продуктов.',
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
        [{ text: CLIENT_LABELS.leaveRequest }],
        [{ text: CLIENT_LABELS.contactAdmin }],
      );
      break;
    case 'client_idle':
      rows.push([{ text: CLIENT_LABELS.buy }], [{ text: CLIENT_LABELS.leaveRequest }]);
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
      rows.push([{ text: CLIENT_LABELS.buy }], [{ text: CLIENT_LABELS.contactAdmin }]);
      break;
  }

  return { keyboard: rows, resize_keyboard: true };
}
