import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type ReminderType,
  formatWebinarDateTime,
  getReminderTestWebinar,
  isReminderType,
  listReminderTestWebinars,
  listWebinarNotificationTemplates,
  reminderTypeLabel,
  runWebinarReminderCheck,
  sendReminderPreviewToAdmin,
} from '@/lib/webinarReminders';

const CALLBACK_PREFIX = 'ar:';

type AdminMessage = {
  chatId: number;
  messageId: number;
};

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

function shorten(value: string, maximum = 40): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function mainButton() {
  return { text: '🏠 Главное меню админа', callback_data: 'admin:home' };
}

function reminderMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📨 Отправить тестовое уведомление себе', callback_data: `${CALLBACK_PREFIX}list` }],
      [{ text: '🔎 Проверить cron-логику без отправки', callback_data: `${CALLBACK_PREFIX}check` }],
      [mainButton()],
    ],
  };
}

function reminderMenuText(): string {
  return (
    '🧪 Тестирование уведомлений о вебинарах\n\n' +
    'Тестовая отправка приходит только текущему администратору и не меняет регистрации, даты вебинара или журнал webinar_reminder_sends.\n\n' +
    'Проверка cron запускает ту же логику определения сроков, но не отправляет сообщения и не создаёт записи.'
  );
}

async function editMessage(message: AdminMessage, text: string, replyMarkup: InlineKeyboard): Promise<void> {
  const result = await telegramSend('editMessageText', {
    chat_id: message.chatId,
    message_id: message.messageId,
    text,
    reply_markup: replyMarkup,
  });

  if (!result.ok && !result.description?.includes('message is not modified')) {
    throw new Error(result.description ?? 'Не удалось обновить административное сообщение.');
  }
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

async function renderWebinarList(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  const webinars = await listReminderTestWebinars(admin);
  if (webinars.length === 0) {
    await editMessage(message, '📭 Вебинаров для тестирования пока нет.', {
      inline_keyboard: [[{ text: '↩️ К тестированию уведомлений', callback_data: `${CALLBACK_PREFIX}menu` }], [mainButton()]],
    });
    return;
  }

  const keyboard: Array<Array<Record<string, string>>> = webinars.map((webinar) => {
    const { date, time } = formatWebinarDateTime(webinar.webinar_date);
    return [
      {
        text: `📅 ${shorten(webinar.title)} · ${date} ${time}`,
        callback_data: `${CALLBACK_PREFIX}webinar:${webinar.id}`,
      },
    ];
  });
  keyboard.push([{ text: '↩️ К тестированию уведомлений', callback_data: `${CALLBACK_PREFIX}menu` }], [mainButton()]);

  await editMessage(
    message,
    '📨 Выберите существующий вебинар для тестового уведомления. Сообщение будет отправлено только вам.',
    { inline_keyboard: keyboard },
  );
}

async function renderReminderTypeSelection(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: `${CALLBACK_PREFIX}list` }], [mainButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: Array<Array<Record<string, string>>> = templates.map((template) => [
    {
      text: `${template.message_text.trim() ? '🔔' : '⚪'} ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)}`,
      callback_data: `${CALLBACK_PREFIX}send:${webinar.id}:${template.reminder_type}`,
    },
  ]);
  keyboard.push([{ text: '↩️ Выбрать другой вебинар', callback_data: `${CALLBACK_PREFIX}list` }], [mainButton()]);

  await editMessage(
    message,
    `🧪 Тестовое уведомление\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите сохранённый шаблон. Сообщение получит только ваш Telegram-аккаунт.`,
    { inline_keyboard: keyboard },
  );
}

export function adminReminderMenuButton() {
  return { text: '🧪 Тест уведомлений', callback_data: `${CALLBACK_PREFIX}menu` };
}

export async function handleAdminReminderTestCallback(
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

  if (action === 'menu') {
    await editMessage(message, reminderMenuText(), reminderMenuKeyboard());
    return true;
  }

  if (action === 'list') {
    await renderWebinarList(admin, message);
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
      await editMessage(message, 'Тестовый сценарий устарел. Выберите вебинар заново.', {
        inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: `${CALLBACK_PREFIX}list` }], [mainButton()]],
      });
      return true;
    }

    try {
      await sendReminderPreviewToAdmin(admin, telegramId, webinar, reminderType);
      await editMessage(
        message,
        `✅ Тестовое уведомление «${reminderTypeLabel(reminderType)}» отправлено только вам.\n\nРегистрации, дата вебинара и webinar_reminder_sends не изменялись.`,
        reminderMenuKeyboard(),
      );
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Не удалось отправить тестовое уведомление.';
      await editMessage(message, `⚠️ Тест не отправлен.\n\n${description}`, reminderMenuKeyboard());
    }
    return true;
  }

  if (action === 'check') {
    const summary = await runWebinarReminderCheck(admin, { dryRun: true });
    await editMessage(message, formatCronCheckResult(summary), reminderMenuKeyboard());
    return true;
  }

  await editMessage(message, reminderMenuText(), reminderMenuKeyboard());
  return true;
}
