import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type ReminderType,
  type WebinarNotificationTemplate,
  createCustomWebinarNotificationTemplate,
  customReminderType,
  formatWebinarDateTime,
  getReminderTestWebinar,
  getWebinarNotificationTemplate,
  isReminderType,
  listReminderTestWebinars,
  listWebinarNotificationTemplates,
  removeWebinarNotificationTemplateFile,
  reminderTypeLabel,
  saveWebinarNotificationTemplate,
} from '@/lib/webinarReminders';

const CALLBACK_PREFIX = 'an:';

type AdminMessage = {
  chatId: number;
  messageId: number;
};

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

type StatePayload = {
  webinarId?: string;
  reminderType?: ReminderType;
};

type ConversationState = {
  chat_id: number;
  message_id: number;
  step: string;
  payload: StatePayload;
};

type IncomingDocument = {
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

const FIXED_REMINDER_TYPES: ReminderType[] = ['3_days', '1_day', '6_hours', '15_minutes'];

function mainButton() {
  return { text: '🏠 Главное меню админа', callback_data: 'admin:home' };
}

function templatesMenuButton() {
  return { text: '↩️ К уведомлениям', callback_data: `${CALLBACK_PREFIX}menu` };
}

function shorten(value: string, maximum = 48): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function safeMinutes(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function callbackKey(reminderType: ReminderType, offsetMinutesBefore?: number): string {
  return FIXED_REMINDER_TYPES.includes(reminderType)
    ? reminderType
    : `c${offsetMinutesBefore ?? reminderType.match(/^custom_(\d+)_minutes$/)?.[1] ?? ''}`;
}

function isConversationStateTableError(error: unknown): boolean {
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

function isTemplateTableError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return message.includes('webinar_notification_templates');
}

async function isAdmin(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data?.role === 'admin';
}

async function editMessage(message: AdminMessage, text: string, replyMarkup: InlineKeyboard): Promise<void> {
  const result = await telegramSend('editMessageText', {
    chat_id: message.chatId,
    message_id: message.messageId,
    text,
    reply_markup: replyMarkup,
  });
  if (!result.ok && !result.description?.includes('message is not modified')) {
    throw new Error(result.description ?? 'Не удалось обновить сообщение управления уведомлениями.');
  }
}

async function getState(admin: SupabaseClient, telegramId: number): Promise<ConversationState | null> {
  const { data, error } = await admin
    .from('bot_conversation_states')
    .select('chat_id, message_id, step, payload')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as ConversationState) : null;
}

async function saveState(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  step: 'notification:custom-offset' | 'notification:text' | 'notification:file',
  payload: StatePayload,
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

async function clearState(admin: SupabaseClient, telegramId: number): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').delete().eq('telegram_id', telegramId);
  if (error) throw error;
}

async function clearStateIfAvailable(admin: SupabaseClient, telegramId: number): Promise<void> {
  try {
    await clearState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

function migrationKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[templatesMenuButton()], [mainButton()]] };
}

async function renderMigrationMessage(message: AdminMessage): Promise<void> {
  await editMessage(
    message,
    '⚠️ Для управления уведомлениями нужно применить SQL-миграцию `supabase/webinar_notification_templates.sql` в Supabase SQL Editor.',
    migrationKeyboard(),
  );
}

async function renderConversationStateMigrationMessage(message: AdminMessage): Promise<void> {
  await editMessage(
    message,
    '⚠️ Для редактирования текста и прикрепления файлов нужно применить SQL-миграцию `supabase/bot_conversation_states.sql` в Supabase SQL Editor.',
    migrationKeyboard(),
  );
}

async function renderWebinarList(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  const webinars = await listReminderTestWebinars(admin);
  if (webinars.length === 0) {
    await editMessage(message, '📭 Вебинаров пока нет.', { inline_keyboard: [[mainButton()]] });
    return;
  }

  const keyboard: Array<Array<Record<string, string>>> = webinars.map((webinar) => {
    const { date, time } = formatWebinarDateTime(webinar.webinar_date);
    return [
      {
        text: `📅 ${shorten(webinar.title)} · ${date} ${time}`,
        callback_data: `${CALLBACK_PREFIX}w:${webinar.id}`,
      },
    ];
  });
  keyboard.push([mainButton()]);

  await editMessage(
    message,
    '🔔 Уведомления вебинара\n\nВыберите вебинар, для которого хотите настроить тексты, вложения и время отправки.',
    { inline_keyboard: keyboard },
  );
}

function templateStatus(template: WebinarNotificationTemplate | undefined): string {
  if (!template) return '⚪ не настроено';
  const text = template.message_text.trim() ? 'текст: ✅' : 'текст: ❌';
  const file = template.file_id ? 'файл: ✅' : 'файл: —';
  return `${text}, ${file}`;
}

async function renderTemplateTypes(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: `${CALLBACK_PREFIX}menu` }], [mainButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const templateByType = new Map(templates.map((template) => [template.reminder_type, template]));
  const customTemplates = templates.filter((template) => !FIXED_REMINDER_TYPES.includes(template.reminder_type));
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: Array<Array<Record<string, string>>> = FIXED_REMINDER_TYPES.map((reminderType) => [
    {
      text: `🔔 ${reminderTypeLabel(reminderType)} · ${templateStatus(templateByType.get(reminderType))}`,
      callback_data: `${CALLBACK_PREFIX}t:${webinar.id}:${reminderType}`,
    },
  ]);

  for (const template of customTemplates) {
    keyboard.push([
      {
        text: `⏱ ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)} · ${templateStatus(template)}`,
        callback_data: `${CALLBACK_PREFIX}t:${webinar.id}:${callbackKey(template.reminder_type, template.offset_minutes_before)}`,
      },
    ]);
  }

  keyboard.push(
    [{ text: '➕ Другое время до вебинара', callback_data: `${CALLBACK_PREFIX}c:${webinar.id}` }],
    [{ text: '↩️ Другой вебинар', callback_data: `${CALLBACK_PREFIX}menu` }],
    [mainButton()],
  );

  await editMessage(
    message,
    `🔔 Уведомления\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите момент напоминания или добавьте произвольное время.`,
    { inline_keyboard: keyboard },
  );
}

async function renderTemplateDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
  reminderType: ReminderType,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: `${CALLBACK_PREFIX}menu` }], [mainButton()]],
    });
    return;
  }

  const template = await getWebinarNotificationTemplate(admin, webinar.id, reminderType);
  const label = reminderTypeLabel(reminderType, template?.offset_minutes_before);
  const textPreview = template?.message_text.trim()
    ? shorten(template.message_text.replace(/\s+/g, ' '), 600)
    : 'Текст пока не задан.';
  const fileStatus = template?.file_id
    ? `✅ Прикреплён: ${template.file_type ?? 'документ'}`
    : '— Файл не прикреплён.';
  const detailCallbackKey = callbackKey(reminderType, template?.offset_minutes_before);
  const keyboard: Array<Array<Record<string, string>>> = [
    [{ text: '📝 Изменить текст', callback_data: `${CALLBACK_PREFIX}x:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📎 Прикрепить PDF / документ', callback_data: `${CALLBACK_PREFIX}f:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📭 Сохранить без файла', callback_data: `${CALLBACK_PREFIX}n:${webinar.id}:${detailCallbackKey}` }],
  ];
  if (template?.file_id) {
    keyboard.push([{ text: '🗑 Удалить прикреплённый файл', callback_data: `${CALLBACK_PREFIX}d:${webinar.id}:${detailCallbackKey}` }]);
  }
  keyboard.push([{ text: '↩️ К типам уведомлений', callback_data: `${CALLBACK_PREFIX}w:${webinar.id}` }], [mainButton()]);

  await editMessage(
    message,
    `🔔 ${label}\n\nВебинар: ${webinar.title}\n\nТекст:\n${textPreview}\n\nФайл: ${fileStatus}\n\nТекст и файл сохраняются отдельно. Файл необязателен.`,
    { inline_keyboard: keyboard },
  );
}

function parseTemplateTarget(
  parts: string[],
): { webinarId: string; reminderType: ReminderType; callbackKey: string } | null {
  const webinarId = parts[2];
  const token = parts[3];
  if (!webinarId || !token) return null;
  if (isReminderType(token)) return { webinarId, reminderType: token, callbackKey: token };

  const customOffset = token.match(/^c([1-9][0-9]*)$/)?.[1];
  if (!customOffset) return null;
  return {
    webinarId,
    reminderType: customReminderType(Number(customOffset)),
    callbackKey: token,
  };
}

export function adminNotificationTemplatesMenuButton() {
  return { text: '🔔 Уведомления', callback_data: `${CALLBACK_PREFIX}menu` };
}

export async function handleAdminNotificationTemplateCallback(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith(CALLBACK_PREFIX)) return false;

  const acknowledge = async (text?: string, showAlert = false) => {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    }
  };

  if (!(await isAdmin(admin, telegramId))) {
    await acknowledge('Доступно только администратору.', true);
    return true;
  }

  const parts = data.split(':');
  const action = parts[1];
  await acknowledge();

  try {
    if (action === 'menu') {
      await clearStateIfAvailable(admin, telegramId);
      await renderWebinarList(admin, message);
      return true;
    }

    if (action === 'w' && parts[2]) {
      await clearStateIfAvailable(admin, telegramId);
      await renderTemplateTypes(admin, message, parts[2]);
      return true;
    }

    if (action === 'c' && parts[2]) {
      try {
        await saveState(admin, telegramId, message, 'notification:custom-offset', { webinarId: parts[2] });
      } catch (error) {
        if (isConversationStateTableError(error)) {
          await renderConversationStateMigrationMessage(message);
          return true;
        }
        throw error;
      }
      await editMessage(
        message,
        '⏱ Отправьте следующим сообщением целое число минут до начала вебинара.\n\nНапример: `90` — уведомление за 1 час 30 минут.\n\nВремя должно быть больше нуля.',
        {
          inline_keyboard: [[{ text: '↩️ Отмена', callback_data: `${CALLBACK_PREFIX}w:${parts[2]}` }], [mainButton()]],
        },
      );
      return true;
    }

    const target = parseTemplateTarget(parts);
    if (!target) {
      await renderWebinarList(admin, message);
      return true;
    }

    if (action === 't') {
      await clearStateIfAvailable(admin, telegramId);
      await renderTemplateDetail(admin, message, target.webinarId, target.reminderType);
      return true;
    }

    if (action === 'x' || action === 'f') {
      try {
        await saveState(
          admin,
          telegramId,
          message,
          action === 'x' ? 'notification:text' : 'notification:file',
          target,
        );
      } catch (error) {
        if (isConversationStateTableError(error)) {
          await renderConversationStateMigrationMessage(message);
          return true;
        }
        throw error;
      }

      await editMessage(
        message,
        action === 'x'
          ? `📝 Отправьте следующим сообщением новый текст уведомления «${reminderTypeLabel(target.reminderType)}». Он сохранится сразу.`
          : `📎 Отправьте следующим сообщением PDF или документ для уведомления «${reminderTypeLabel(target.reminderType)}». Бот сохранит Telegram file_id автоматически.`,
        {
          inline_keyboard: [[{ text: '↩️ Отмена', callback_data: `${CALLBACK_PREFIX}t:${target.webinarId}:${target.callbackKey}` }], [mainButton()]],
        },
      );
      return true;
    }

    if (action === 'd' || action === 'n') {
      await removeWebinarNotificationTemplateFile(admin, target.webinarId, target.reminderType);
      await renderTemplateDetail(admin, message, target.webinarId, target.reminderType);
      return true;
    }

    await renderTemplateTypes(admin, message, target.webinarId);
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderMigrationMessage(message);
      return true;
    }
    throw error;
  }
}

export async function handleAdminNotificationTemplateText(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await isAdmin(admin, telegramId))) return false;

  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (!state || state.chat_id !== chatId) return false;

  const webinarId = state.payload.webinarId;
  const reminderType = state.payload.reminderType;
  if (!webinarId) {
    await clearState(admin, telegramId);
    return false;
  }

  try {
    if (state.step === 'notification:custom-offset') {
      const minutes = safeMinutes(text);
      if (!minutes) {
        await telegramSend('sendMessage', {
          chat_id: chatId,
          text: 'Введите целое положительное число минут, например: 90.',
        });
        return true;
      }
      const template = await createCustomWebinarNotificationTemplate(admin, webinarId, minutes);
      await clearState(admin, telegramId);
      await renderTemplateDetail(
        admin,
        { chatId: state.chat_id, messageId: state.message_id },
        webinarId,
        template.reminder_type,
      );
      return true;
    }

    if (state.step !== 'notification:text' || !reminderType || !isReminderType(reminderType)) return false;
    await saveWebinarNotificationTemplate(admin, {
      webinarId,
      reminderType,
      messageText: text.trim(),
    });
    await clearState(admin, telegramId);
    await renderTemplateDetail(admin, { chatId: state.chat_id, messageId: state.message_id }, webinarId, reminderType);
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderMigrationMessage({ chatId: state.chat_id, messageId: state.message_id });
      return true;
    }
    if (error instanceof Error) {
      await telegramSend('sendMessage', { chat_id: chatId, text: `⚠️ ${error.message}` });
      return true;
    }
    throw error;
  }
}

export async function handleAdminNotificationTemplateDocument(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  document: IncomingDocument,
): Promise<boolean> {
  if (!(await isAdmin(admin, telegramId))) return false;

  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (state?.step !== 'notification:file' || state.chat_id !== chatId) return false;

  const webinarId = state.payload.webinarId;
  const reminderType = state.payload.reminderType;
  if (!webinarId || !reminderType || !isReminderType(reminderType)) {
    await clearState(admin, telegramId);
    return false;
  }

  try {
    await saveWebinarNotificationTemplate(admin, {
      webinarId,
      reminderType,
      fileId: document.fileId,
      fileType: document.mimeType ?? document.fileName ?? 'document',
    });
    await clearState(admin, telegramId);
    await renderTemplateDetail(admin, { chatId: state.chat_id, messageId: state.message_id }, webinarId, reminderType);
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderMigrationMessage({ chatId: state.chat_id, messageId: state.message_id });
      return true;
    }
    throw error;
  }
}
