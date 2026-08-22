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
  runWebinarReminderCheck,
  saveWebinarNotificationTemplate,
  sendReminderPreviewToAdmin,
} from '@/lib/webinarReminders';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  type InlineKeyboard,
  clearState,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  homeButton,
  isConversationStateTableError,
  isTemplateTableError,
  migrationText,
  saveState,
  sendDeliver,
  shorten,
} from './core';

// ---------------------------------------------------------------------------
// Выбор вебинара (общий список для тестов уведомлений и шаблонов)
// ---------------------------------------------------------------------------

async function renderWebinarPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  options: {
    text: string;
    emptyText: string;
    pickCallback: (webinarId: string) => string;
    backButtons: InlineButton[][];
  },
): Promise<void> {
  const webinars = await listReminderTestWebinars(admin);
  if (webinars.length === 0) {
    await editAdminMessage(message, options.emptyText, { inline_keyboard: options.backButtons });
    return;
  }

  const keyboard: InlineButton[][] = webinars.map((webinar) => {
    const { date, time } = formatWebinarDateTime(webinar.webinar_date);
    return [{
      text: `📅 ${shorten(webinar.title)} · ${date} ${time}`,
      callback_data: options.pickCallback(String(webinar.id)),
    }];
  });
  keyboard.push(...options.backButtons);

  await editAdminMessage(message, options.text, { inline_keyboard: keyboard });
}

// ---------------------------------------------------------------------------
// Тестирование уведомлений (префикс ar:)
// ---------------------------------------------------------------------------

const REMINDER_MENU_TEXT =
  '🧪 Тестирование уведомлений о вебинарах\n\n' +
  'Тестовая отправка приходит только текущему администратору и не меняет регистрации, даты вебинара или журнал webinar_reminder_sends.\n\n' +
  'Проверка cron запускает ту же логику определения сроков, но не отправляет сообщения и не создаёт записи.';

function reminderMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📨 Отправить тестовое уведомление себе', callback_data: 'ar:list' }],
      [{ text: '🔎 Проверить cron-логику без отправки', callback_data: 'ar:check' }],
      [homeButton()],
    ],
  };
}

function reminderBackButtons(): InlineButton[][] {
  return [[{ text: '↩️ К тестированию уведомлений', callback_data: 'ar:menu' }], [homeButton()]];
}

function formatCronCheckResult(
  summary: Awaited<ReturnType<typeof runWebinarReminderCheck>>,
): string {
  const lines = [
    '🔎 Проверка cron-логики завершена',
    '',
    `Активных будущих вебинаров: ${summary.processedWebinars}`,
    `Напоминаний к отправке сейчас: ${summary.planned}`,
    `Уже отправлено ранее: ${summary.skippedAlreadySent}`,
    `Пропущено некорректных получателей: ${summary.skippedInvalidRecipient}`,
    `Пропущено без сохранённого шаблона: ${summary.skippedMissingTemplate}`,
    `Ошибок чтения: ${summary.failed}`,
  ];

  if (summary.due.length > 0) {
    lines.push('', 'Сработавшие контрольные точки:');
    for (const item of summary.due.slice(0, 10)) {
      lines.push(
        `• ${reminderTypeLabel(item.reminderType, item.offsetMinutesBefore)}: ${shorten(item.title, 34)} — получателей ${item.recipients}`,
      );
    }
    if (summary.due.length > 10) lines.push(`… и ещё ${summary.due.length - 10}.`);
  } else {
    lines.push('', 'Сейчас ни для одного активного вебинара не наступила контрольная точка.');
  }

  lines.push('', 'Сообщения не отправлялись, таблица webinar_reminder_sends не изменялась.');
  return lines.join('\n');
}

async function renderReminderTypeSelection(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: 'ar:list' }], [homeButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: InlineButton[][] = templates.map((template) => [
    {
      text: `${template.message_text.trim() ? '🔔' : '⚪'} ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)}`,
      callback_data: `ar:send:${webinar.id}:${template.reminder_type}`,
    },
  ]);
  keyboard.push([{ text: '↩️ Выбрать другой вебинар', callback_data: 'ar:list' }], [homeButton()]);

  await editAdminMessage(
    message,
    `🧪 Тестовое уведомление\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите сохранённый шаблон. Сообщение получит только ваш Telegram-аккаунт.`,
    { inline_keyboard: keyboard },
  );
}

// Callback-кнопки тестирования уведомлений (префикс ar:). Всегда возвращает true.
export async function handleReminderAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const parts = data.split(':');
  const action = parts[1];

  if (action === 'list') {
    await renderWebinarPicker(admin, message, {
      text: '📨 Выберите существующий вебинар для тестового уведомления. Сообщение будет отправлено только вам.',
      emptyText: '📭 Вебинаров для тестирования пока нет.',
      pickCallback: (webinarId) => `ar:webinar:${webinarId}`,
      backButtons: reminderBackButtons(),
    });
    return true;
  }

  if (action === 'webinar' && parts[2]) {
    await renderReminderTypeSelection(admin, message, parts[2]);
    return true;
  }

  if (action === 'send' && parts[2] && isReminderType(parts[3])) {
    const reminderType = parts[3] as ReminderType;
    const webinar = await getReminderTestWebinar(admin, parts[2]);
    if (!webinar) {
      await editAdminMessage(message, 'Тестовый сценарий устарел. Выберите вебинар заново.', {
        inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: 'ar:list' }], [homeButton()]],
      });
      return true;
    }

    try {
      await sendReminderPreviewToAdmin(admin, telegramId, webinar, reminderType);
      await editAdminMessage(
        message,
        `✅ Тестовое уведомление «${reminderTypeLabel(reminderType)}» отправлено только вам.\n\nРегистрации, дата вебинара и webinar_reminder_sends не изменялись.`,
        reminderMenuKeyboard(),
      );
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Не удалось отправить тестовое уведомление.';
      await editAdminMessage(message, `⚠️ Тест не отправлен.\n\n${description}`, reminderMenuKeyboard());
    }
    return true;
  }

  if (action === 'check') {
    const summary = await runWebinarReminderCheck(admin, { dryRun: true });
    await editAdminMessage(message, formatCronCheckResult(summary), reminderMenuKeyboard());
    return true;
  }

  // 'menu' и неизвестные ar:-кнопки — меню тестирования.
  await editAdminMessage(message, REMINDER_MENU_TEXT, reminderMenuKeyboard());
  return true;
}

// ---------------------------------------------------------------------------
// Шаблоны уведомлений (префикс an:)
// ---------------------------------------------------------------------------

const FIXED_REMINDER_TYPES: ReminderType[] = ['3_days', '1_day', '6_hours', '15_minutes'];

function templatesMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '↩️ К уведомлениям', callback_data: 'an:menu' }],
      [homeButton()],
    ],
  };
}

function safeMinutes(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Короткий ключ для callback_data: фиксированные типы как есть,
// произвольные — как c<минуты>, чтобы уложиться в лимит 64 символа.
function callbackKey(reminderType: ReminderType, offsetMinutesBefore?: number): string {
  return FIXED_REMINDER_TYPES.includes(reminderType)
    ? reminderType
    : `c${offsetMinutesBefore ?? reminderType.match(/^custom_(\d+)_minutes$/)?.[1] ?? ''}`;
}

function templateStatus(template: WebinarNotificationTemplate | undefined): string {
  if (!template) return '⚪ не настроено';
  const text = template.message_text.trim() ? 'текст: ✅' : 'текст: ❌';
  const file = template.file_id ? 'файл: ✅' : 'файл: —';
  return `${text}, ${file}`;
}

export async function renderTemplateMigrationMessage(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, migrationText('webinar_notification_templates.sql'), templatesMenuKeyboard());
}

async function renderTemplateTypes(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: 'an:menu' }], [homeButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const templateByType = new Map(templates.map((template) => [template.reminder_type, template]));
  const customTemplates = templates.filter((template) => !FIXED_REMINDER_TYPES.includes(template.reminder_type));
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: InlineButton[][] = FIXED_REMINDER_TYPES.map((reminderType) => [
    {
      text: `🔔 ${reminderTypeLabel(reminderType)} · ${templateStatus(templateByType.get(reminderType))}`,
      callback_data: `an:t:${webinar.id}:${reminderType}`,
    },
  ]);

  for (const template of customTemplates) {
    keyboard.push([
      {
        text: `⏱ ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)} · ${templateStatus(template)}`,
        callback_data: `an:t:${webinar.id}:${callbackKey(template.reminder_type, template.offset_minutes_before)}`,
      },
    ]);
  }

  keyboard.push(
    [{ text: '➕ Другое время до вебинара', callback_data: `an:c:${webinar.id}` }],
    [{ text: '↩️ Другой вебинар', callback_data: 'an:menu' }],
    [homeButton()],
  );

  await editAdminMessage(
    message,
    `🔔 Уведомления\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите момент напоминания или добавьте произвольное время.`,
    { inline_keyboard: keyboard },
  );
}

// deliver позволяет показать карточку и в ответ на callback (edit),
// и новым сообщением после текстового/файлового ввода.
export async function renderTemplateDetail(
  admin: SupabaseClient,
  deliver: Deliver,
  webinarId: string,
  reminderType: ReminderType,
  notice = '',
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await deliver('Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: 'an:menu' }], [homeButton()]],
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
  const keyboard: InlineButton[][] = [
    [{ text: '📝 Изменить текст', callback_data: `an:x:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📎 Прикрепить PDF / документ', callback_data: `an:f:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📭 Сохранить без файла', callback_data: `an:n:${webinar.id}:${detailCallbackKey}` }],
  ];
  if (template?.file_id) {
    keyboard.push([{ text: '🗑 Удалить прикреплённый файл', callback_data: `an:d:${webinar.id}:${detailCallbackKey}` }]);
  }
  keyboard.push([{ text: '↩️ К типам уведомлений', callback_data: `an:w:${webinar.id}` }], [homeButton()]);

  await deliver(
    `${notice ? `${notice}

` : ''}🔔 ${label}

Вебинар: ${webinar.title}

Текст:
${textPreview}

Файл: ${fileStatus}

Текст и файл сохраняются отдельно. Файл необязателен.`,
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

// Callback-кнопки шаблонов уведомлений (префикс an:). Всегда возвращает true.
export async function handleTemplateAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const parts = data.split(':');
  const action = parts[1];

  if (action === 'menu') {
    await clearStateIfAvailable(admin, telegramId);
    await renderWebinarPicker(admin, message, {
      text: '🔔 Уведомления вебинара\n\nВыберите вебинар, для которого хотите настроить тексты, вложения и время отправки.',
      emptyText: '📭 Вебинаров пока нет.',
      pickCallback: (webinarId) => `an:w:${webinarId}`,
      backButtons: [[homeButton()]],
    });
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
        await editAdminMessage(message, migrationText('bot_conversation_states.sql'), templatesMenuKeyboard());
        return true;
      }
      throw error;
    }
    await editAdminMessage(
      message,
      '⏱ Отправьте следующим сообщением целое число минут до начала вебинара.\n\nНапример: `90` — уведомление за 1 час 30 минут.\n\nВремя должно быть больше нуля.',
      {
        inline_keyboard: [[{ text: '↩️ Отмена', callback_data: `an:w:${parts[2]}` }], [homeButton()]],
      },
    );
    return true;
  }

  const target = parseTemplateTarget(parts);
  if (!target) {
    await renderWebinarPicker(admin, message, {
      text: '🔔 Уведомления вебинара\n\nВыберите вебинар, для которого хотите настроить тексты, вложения и время отправки.',
      emptyText: '📭 Вебинаров пока нет.',
      pickCallback: (webinarId) => `an:w:${webinarId}`,
      backButtons: [[homeButton()]],
    });
    return true;
  }

  if (action === 't') {
    await clearStateIfAvailable(admin, telegramId);
    await renderTemplateDetail(admin, editDeliver(message), target.webinarId, target.reminderType);
    return true;
  }

  if (action === 'x' || action === 'f') {
    try {
      await saveState(
        admin,
        telegramId,
        message,
        action === 'x' ? 'notification:text' : 'notification:file',
        { webinarId: target.webinarId, reminderType: target.reminderType },
      );
    } catch (error) {
      if (isConversationStateTableError(error)) {
        await editAdminMessage(message, migrationText('bot_conversation_states.sql'), templatesMenuKeyboard());
        return true;
      }
      throw error;
    }

    await editAdminMessage(
      message,
      action === 'x'
        ? `📝 Отправьте следующим сообщением новый текст уведомления «${reminderTypeLabel(target.reminderType)}». Он сохранится сразу.`
        : `📎 Отправьте следующим сообщением PDF или документ для уведомления «${reminderTypeLabel(target.reminderType)}». Бот сохранит Telegram file_id автоматически.`,
      {
        inline_keyboard: [
          [{ text: '↩️ Отмена', callback_data: `an:t:${target.webinarId}:${target.callbackKey}` }],
          [homeButton()],
        ],
      },
    );
    return true;
  }

  if (action === 'd' || action === 'n') {
    await removeWebinarNotificationTemplateFile(admin, target.webinarId, target.reminderType);
    await renderTemplateDetail(admin, editDeliver(message), target.webinarId, target.reminderType);
    return true;
  }

  await renderTemplateTypes(admin, message, target.webinarId);
  return true;
}

// Текстовый шаг настройки шаблонов: произвольный офсет или новый текст.
export async function handleNotificationTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const payload = state.payload ?? {};
  const webinarId = payload.webinarId;
  if (!webinarId) {
    await clearState(admin, telegramId);
    return false;
  }

  try {
    if (state.step === 'notification:custom-offset') {
      const minutes = safeMinutes(text);
      if (!minutes) {
        await telegramSend('sendMessage', {
          chat_id: state.chat_id,
          text: 'Введите целое положительное число минут, например: 90.',
        });
        return true;
      }
      const template = await createCustomWebinarNotificationTemplate(admin, webinarId, minutes);
      await clearState(admin, telegramId);
      // Результат текстового ввода — новое сообщение.
      await renderTemplateDetail(admin, sendDeliver(state.chat_id), webinarId, template.reminder_type, '✅ Шаблон создан.');
      return true;
    }

    const reminderType = payload.reminderType;
    if (state.step !== 'notification:text' || !reminderType || !isReminderType(reminderType)) return false;
    await saveWebinarNotificationTemplate(admin, {
      webinarId,
      reminderType,
      messageText: text.trim(),
    });
    await clearState(admin, telegramId);
    await renderTemplateDetail(admin, sendDeliver(state.chat_id), webinarId, reminderType, '✅ Текст шаблона сохранён.');
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderTemplateMigrationMessage(message);
      return true;
    }
    if (error instanceof Error) {
      await telegramSend('sendMessage', { chat_id: state.chat_id, text: `⚠️ ${error.message}` });
      return true;
    }
    throw error;
  }
}
