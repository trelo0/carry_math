import type { ClientStateSnapshot, ClientUiPhase } from './client-state';
import { getClientProductMode } from './client-state';
import { BOT_COPY_KEYS, getBotCopy } from '@/lib/bot/bot-copy';

export const CLIENT_LABELS = {
  onlineCourse: '🎓 Онлайн-курс',
  lessonsWithTeacher: '👨‍🏫 Занятия с преподавателем',
  contactAdmin: '💬 Связаться с администратором',
  /** @deprecated используйте lessonsWithTeacher */
  buy: '👨‍🏫 Занятия с преподавателем',
  leaveRequest: '📝 Оставить заявку на занятия',
  myLessons: '📚 Мои занятия',
  myCourse: '🎓 Мой курс',
  homework: '📝 Домашние задания',
  contactTeacher: '💬 Связаться с преподавателем',
  contactCurator: '💬 Связаться с куратором',
  contact: '💬 Связь',
  payments: '💳 Оплаты',
  misc: '⋯ Прочее',
  buyEducation: '🎓 Купить обучение',
  schedule: '🗓 Расписание',
  myPackage: '📦 Мой пакет',
  purchaseHistory: '🧾 История',
  myApplications: '📨 История обращений',
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

const WELCOME_KEY: Record<ClientUiPhase, (typeof BOT_COPY_KEYS)[keyof typeof BOT_COPY_KEYS]> = {
  guest: BOT_COPY_KEYS.guestWelcome,
  client_idle: BOT_COPY_KEYS.guestWelcomeIdle,
  client_active: BOT_COPY_KEYS.guestWelcomeActive,
};

export async function buildClientWelcomeTextAsync(
  state: ClientStateSnapshot,
  testFooter = '',
): Promise<string> {
  return (await getBotCopy(WELCOME_KEY[state.phase])) + testFooter;
}

export function buildClientReplyKeyboard(state: ClientStateSnapshot): ClientReplyKeyboard {
  const rows: Array<Array<{ text: string }>> = [];

  switch (state.phase) {
    case 'guest':
      rows.push(
        [{ text: CLIENT_LABELS.onlineCourse }],
        [{ text: CLIENT_LABELS.lessonsWithTeacher }],
        [{ text: CLIENT_LABELS.contactAdmin }],
      );
      break;
    case 'client_idle':
      rows.push(
        [{ text: CLIENT_LABELS.myLessons }, { text: CLIENT_LABELS.buyEducation }],
        [{ text: CLIENT_LABELS.purchaseHistory }, { text: CLIENT_LABELS.myApplications }],
        [{ text: CLIENT_LABELS.contactAdmin }],
      );
      break;
    case 'client_active': {
      const mode = getClientProductMode(state);
      if (mode === 'both') {
        rows.push(
          [{ text: CLIENT_LABELS.schedule }, { text: CLIENT_LABELS.myCourse }],
          [{ text: CLIENT_LABELS.contact }, { text: CLIENT_LABELS.payments }],
          [{ text: CLIENT_LABELS.misc }],
        );
      } else if (mode === 'course') {
        rows.push(
          [{ text: CLIENT_LABELS.myCourse }, { text: CLIENT_LABELS.homework }],
          [{ text: CLIENT_LABELS.contactCurator }, { text: CLIENT_LABELS.payments }],
          [{ text: CLIENT_LABELS.misc }],
        );
      } else {
        // lessons
        rows.push(
          [{ text: CLIENT_LABELS.myLessons }, { text: CLIENT_LABELS.homework }],
          [{ text: CLIENT_LABELS.contactTeacher }, { text: CLIENT_LABELS.payments }],
          [{ text: CLIENT_LABELS.misc }],
        );
      }
      break;
    }
  }

  return { keyboard: rows, resize_keyboard: true };
}
