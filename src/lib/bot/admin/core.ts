import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import type { ReminderType } from '@/lib/webinarReminders';

// Общая инфраструктура админ-панели бота: типы, клавиатуры, доставка
// сообщений и состояние диалога (bot_conversation_states).

export type AdminMessage = {
  chatId: number;
  messageId: number;
};

export type InlineButton = Record<string, string>;

export type InlineKeyboard = {
  inline_keyboard: Array<Array<InlineButton>>;
};

export type Webinar = {
  id: string | number;
  title: string;
  description: string | null;
  webinar_date: string;
  registration_url: string | null;
  is_active: boolean;
};

export type BroadcastAttachmentKind = 'document' | 'photo';

// Общий payload состояния диалога: черновик вебинара и/или контекст
// редактируемого вебинара или настраиваемого шаблона уведомления.
// category/page — контекст навигации по пользователям для кнопки «Назад».
// Поля broadcast:* — конструктор массовой рассылки.
export type AdminPayload = {
  title?: string;
  description?: string | null;
  webinar_date?: string;
  registration_url?: string | null;
  webinarId?: string;
  reminderType?: ReminderType;
  category?: string;
  page?: number;
  audience?: string;
  broadcastText?: string;
  attachmentKind?: BroadcastAttachmentKind;
  fileId?: string;
  fileName?: string;
  buttonText?: string;
  buttonUrl?: string;
};

export type ConversationStep =
  | 'create:title'
  | 'create:description'
  | 'create:date'
  | 'create:url'
  | 'create:preview'
  | 'create:edit:title'
  | 'create:edit:description'
  | 'create:edit:date'
  | 'create:edit:url'
  | 'edit:title'
  | 'edit:description'
  | 'edit:date'
  | 'edit:url'
  | 'notification:custom-offset'
  | 'notification:text'
  | 'notification:file'
  | 'users:search'
  | 'moderation:search'
  | 'broadcast:text'
  | 'broadcast:compose'
  | 'broadcast:button-text'
  | 'broadcast:button-url'
  | 'broadcast:preview'
  | 'broadcast:confirm';

export type ConversationState = {
  telegram_id: number;
  chat_id: number;
  message_id: number;
  step: ConversationStep;
  payload: AdminPayload;
};

export type IncomingDocument = {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  // document — файл/PDF, photo — изображение (file_id максимального размера).
  kind?: 'document' | 'photo';
};

// ---------------------------------------------------------------------------
// Доступ и состояние диалога
// ---------------------------------------------------------------------------

export async function isAdmin(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data?.role === 'admin';
}

export async function editAdminMessage(
  message: AdminMessage,
  text: string,
  replyMarkup: InlineKeyboard,
): Promise<void> {
  const result = await telegramSend('editMessageText', {
    chat_id: message.chatId,
    message_id: message.messageId,
    text,
    reply_markup: replyMarkup,
  });

  // Telegram возвращает ошибку, когда экран уже содержит те же текст и кнопки.
  if (!result.ok && !result.description?.includes('message is not modified')) {
    throw new Error(result.description ?? 'Не удалось обновить административное сообщение.');
  }
}

// 42P01 — таблицы нет в БД, PGRST205 — PostgREST ещё не подхватил схему.
export function isConversationStateTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('bot_conversation_states') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

export function isTemplateTableError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return message.includes('webinar_notification_templates');
}

export async function getState(admin: SupabaseClient, telegramId: number): Promise<ConversationState | null> {
  const { data, error } = await admin
    .from('bot_conversation_states')
    .select('telegram_id, chat_id, message_id, step, payload')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as ConversationState) : null;
}

export async function saveState(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  step: ConversationStep,
  payload: AdminPayload,
): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').upsert(
    {
      telegram_id: telegramId,
      chat_id: message.chatId,
      message_id: message.messageId,
      step,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' },
  );
  if (error) throw error;
}

export async function clearState(admin: SupabaseClient, telegramId: number): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').delete().eq('telegram_id', telegramId);
  if (error) throw error;
}

// Возврат в меню не должен ломаться, даже если миграция состояния ещё не применена.
export async function clearStateIfAvailable(admin: SupabaseClient, telegramId: number): Promise<void> {
  try {
    await clearState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    console.error('Таблица состояния диалогов не применена:', error);
  }
}

// ---------------------------------------------------------------------------
// Архитектура интерфейса админа:
// • Reply Keyboard — постоянное главное меню под полем ввода;
// • Inline Keyboard — действия внутри раздела (навигация по нажатию кнопок
//   идёт через editMessageText — локальное обновление текущего блока);
// • новое сообщение — всегда, когда результатом является ответ на текстовый
//   или файловый ввод админа (чтобы не заставлять листать чат вверх).
// ---------------------------------------------------------------------------

export type Deliver = (text: string, keyboard?: InlineKeyboard) => Promise<number | null>;

// Локальная навигация по inline-кнопкам: редактируем текущее сообщение.
export function editDeliver(message: AdminMessage): Deliver {
  return async (text, keyboard) => {
    await editAdminMessage(message, text, keyboard ?? { inline_keyboard: [[homeButton()]] });
    return message.messageId;
  };
}

// Ответ на текстовый/файловый ввод админа: всегда новое сообщение, чтобы
// результат появлялся сразу под сообщением администратора.
// Возвращает message_id отправленного сообщения (для saveState).
export async function sendAdminMessage(
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<number | null> {
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
  if (!result.ok) {
    throw new Error(result.description ?? 'Не удалось отправить административное сообщение.');
  }
  return result.result?.message_id ?? null;
}

export function sendDeliver(chatId: number): Deliver {
  return (text, keyboard) => sendAdminMessage(chatId, text, keyboard);
}

// ---------------------------------------------------------------------------
// Общие мелочи
// ---------------------------------------------------------------------------

export function shorten(value: string, maximum = 40): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function migrationText(migrationFile: string): string {
  return `⚠️ Для этой функции нужно применить SQL-миграцию \`supabase/${migrationFile}\` в Supabase SQL Editor.`;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function homeButton(): InlineButton {
  return { text: '🏠 Главное меню админа', callback_data: 'admin:home' };
}

export function homeOnlyKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[homeButton()]] };
}

// Размер страницы списков пользователей (users и «Заблокированные» контроля).
export const USERS_PER_PAGE = 5;

// ---------------------------------------------------------------------------
// Главное меню админа
// ---------------------------------------------------------------------------

// Постоянное главное меню: Reply Keyboard находится под полем ввода и не
// теряется в истории чата.
export type ReplyKeyboard = { keyboard: Array<Array<{ text: string }>>; resize_keyboard: boolean };

export function adminReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: '👥 Пользователи' }, { text: '📢 Рассылки' }],
      [{ text: '📊 Статистика' }, { text: '🚨 Контроль' }],
      [{ text: '📅 Вебинары' }, { text: '⚙️ Настройки' }],
      [{ text: '📝 Заявки' }],
    ],
    resize_keyboard: true,
  };
}

// Нажатие Reply-кнопки приходит как обычный текст с точным названием.
export const ADMIN_REPLY_LABELS = {
  users: '👥 Пользователи',
  broadcasts: '📢 Рассылки',
  stats: '📊 Статистика',
  moderation: '🚨 Контроль',
  webinars: '📅 Вебинары',
  settings: '⚙️ Настройки',
  leads: '📝 Заявки',
} as const;

export const ADMIN_REPLY_LABEL_SET = new Set<string>(Object.values(ADMIN_REPLY_LABELS));

export const ADMIN_UNKNOWN_TEXT =
  'Я не понял это сообщение.\n\nРазделы панели — на кнопках меню под полем ввода.';

export const ADMIN_HOME_TEXT =
  '🔐 Панель администратора District\n\n' +
  'Разделы — на кнопках меню под полем ввода. Оно всегда на месте, листать историю не нужно.';

const ADMIN_HOME_POINTER_TEXT =
  '🏠 Главное меню администратора\n\nКнопки разделов — на постоянной клавиатуре под полем ввода.';

export async function showAdminHome(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, ADMIN_HOME_POINTER_TEXT, { inline_keyboard: [] });
}
