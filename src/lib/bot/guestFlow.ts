import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';

export const GUEST_CALLBACKS = {
  main: 'guest:main',
  // Сохраняем обработку кнопки из сообщений предыдущей версии бота.
  begin: 'guest:begin',
  cheatsheet: 'guest:cheatsheet',
  cheatsheetAgain: 'guest:cheatsheet-again',
  webinar: 'guest:webinar',
  webinarRegister: 'guest:webinar-register',
  when: 'guest:when',
  channel: 'guest:channel',
} as const;

type ActiveWebinar = {
  id: string | number;
  webinar_date: string;
};

type GuestMessage = {
  chatId: number;
  messageId: number;
};

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

const GUEST_WELCOME_TEXT =
  '👋 Добро пожаловать в онлайн-школу математики District!\n\n' +
  'Здесь можно забрать спонсорскую помощь, записаться на бесплатный вебинар и следить за новостями школы.';

const CHEATSHEET_DELIVERY_TEXT =
  '📕 Отправляю спонсорскую помощь — она поможет быстро повторить самое важное.';

const CHEATSHEET_AFTER_TEXT =
  '📌 Спонсорская помощь уже у тебя. Теперь можно записаться на бесплатный вебинар.';

const CHANNEL_TEXT =
  '📢 Подписывайся на канал Лидии — там анонсы вебинаров, разборы задач и советы по математике.';

function getChannelUrl(): string {
  return process.env.LIDIA_CHANNEL_URL ?? 'https://t.me/district_math';
}

function mainMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📕 Забрать спонсорскую помощь', callback_data: GUEST_CALLBACKS.cheatsheet }],
      [{ text: '📝 Записаться на бесплатный вебинар', callback_data: GUEST_CALLBACKS.webinar }],
      [{ text: '📢 Канал Лидии', callback_data: GUEST_CALLBACKS.channel }],
    ],
  };
}

function mainMenuButton() {
  return { text: '🏠 Главное меню', callback_data: GUEST_CALLBACKS.main };
}

async function editGuestMessage(
  message: GuestMessage,
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
    throw new Error(result.description ?? 'Не удалось обновить сообщение меню.');
  }
}

function formatWebinarDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatTimeRemaining(webinarDate: Date): string {
  const milliseconds = webinarDate.getTime() - Date.now();
  if (milliseconds <= 0) return 'Вебинар уже начался или завершился.';

  const totalHours = Math.ceil(milliseconds / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`);
  if (hours > 0 || parts.length === 0) parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`);

  return `До начала осталось: ${parts.join(' ')}.`;
}

async function getActiveWebinar(admin: SupabaseClient): Promise<ActiveWebinar | null> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, webinar_date')
    .eq('is_active', true)
    .order('webinar_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ActiveWebinar | null;
}

async function hasReceivedCheatsheet(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_member_actions')
    .select('cheat_sheet_received')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw error;
  return data?.cheat_sheet_received === true;
}

async function markCheatsheetReceived(admin: SupabaseClient, telegramId: number): Promise<void> {
  const { error } = await admin
    .from('bot_member_actions')
    .upsert({ telegram_id: telegramId, cheat_sheet_received: true }, { onConflict: 'telegram_id' });

  if (error) throw error;
}

async function isRegisteredForWebinar(
  admin: SupabaseClient,
  telegramId: number,
  webinarId: ActiveWebinar['id'],
): Promise<boolean> {
  const { data, error } = await admin
    .from('webinar_registrations')
    .select('webinar_id')
    .eq('webinar_id', webinarId)
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function renderNoActiveWebinar(message: GuestMessage): Promise<void> {
  await editGuestMessage(
    message,
    '📅 Сейчас нет активного вебинара. Следи за анонсами в канале Лидии.',
    { inline_keyboard: [[mainMenuButton()]] },
  );
}

// Единая точка возврата во всех сценариях гостя.
export async function renderMainMenu(
  chatId: number,
  testFooter = '',
  messageId?: number,
): Promise<void> {
  const text = GUEST_WELCOME_TEXT + testFooter;
  if (messageId) {
    await editGuestMessage({ chatId, messageId }, text, mainMenuKeyboard());
    return;
  }

  // Только /start создаёт начальное сообщение меню.
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: mainMenuKeyboard(),
  });
}

// /start использует это имя, чтобы не менять уже работающий маршрут webhook.
export async function guestStart(chatId: number, testFooter = ''): Promise<void> {
  await renderMainMenu(chatId, testFooter);
}

async function sendCheatsheet(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
): Promise<void> {
  const fileId = process.env.GUEST_PDF_FILE_ID;
  if (!fileId) throw new Error('GUEST_PDF_FILE_ID is not configured');

  await editGuestMessage(
    message,
    CHEATSHEET_DELIVERY_TEXT,
    { inline_keyboard: [[mainMenuButton()]] },
  );

  const result = await telegramSend('sendDocument', {
    chat_id: message.chatId,
    document: fileId,
    caption: '📄 Спонсорская помощь — онлайн-школа District',
  });
  if (!result.ok) throw new Error(result.description ?? 'Не удалось отправить PDF-файл.');

  await markCheatsheetReceived(admin, telegramId);
  await editGuestMessage(message, CHEATSHEET_AFTER_TEXT, {
    inline_keyboard: [
      [{ text: '📝 Записаться на бесплатный вебинар', callback_data: GUEST_CALLBACKS.webinar }],
      [mainMenuButton()],
    ],
  });
}

async function renderWebinarFlow(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(message);
    return;
  }

  const registered = await isRegisteredForWebinar(admin, telegramId, webinar.id);
  if (registered) {
    await editGuestMessage(message, '✅ Вы уже записаны на бесплатный вебинар.', {
      inline_keyboard: [
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    });
    return;
  }

  await editGuestMessage(
    message,
    '📝 Бесплатный вебинар поможет разобраться, как подтянуть математику без зубрёжки. Займи место по кнопке ниже.',
    {
      inline_keyboard: [
        [{ text: '📝 Записаться на вебинар', callback_data: GUEST_CALLBACKS.webinarRegister }],
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    },
  );
}

async function registerForWebinar(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(message);
    return;
  }

  if (await isRegisteredForWebinar(admin, telegramId, webinar.id)) {
    await editGuestMessage(message, '✅ Вы уже записаны на бесплатный вебинар.', {
      inline_keyboard: [
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    });
    return;
  }

  const { error } = await admin.from('webinar_registrations').insert({
    webinar_id: webinar.id,
    telegram_id: telegramId,
    registered_at: new Date().toISOString(),
  });

  if (error && error.code !== '23505') throw error;

  await editGuestMessage(
    message,
    error?.code === '23505'
      ? '✅ Вы уже записаны на бесплатный вебинар.'
      : '✅ Вы успешно записались на бесплатный вебинар!',
    {
      inline_keyboard: [
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    },
  );
}

async function showWebinarDate(admin: SupabaseClient, message: GuestMessage): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(message);
    return;
  }

  const date = new Date(webinar.webinar_date);
  const text = Number.isNaN(date.getTime())
    ? '📅 Дата активного вебинара пока уточняется.'
    : `📅 Вебинар состоится ${formatWebinarDate(date)}.\n${formatTimeRemaining(date)}`;

  await editGuestMessage(message, text, { inline_keyboard: [[mainMenuButton()]] });
}

async function showChannel(message: GuestMessage): Promise<void> {
  const url = getChannelUrl();
  await editGuestMessage(message, CHANNEL_TEXT, {
    inline_keyboard: [
      [{ text: '🔗 Перейти в канал', url }],
      [mainMenuButton()],
    ],
  });
}

// Обработка callback-кнопок гостевого меню. Возвращает true для известных сценариев.
export async function handleGuestCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const ack = (text?: string) =>
    callbackQueryId
      ? telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
      : Promise.resolve({ ok: true });
  const message = { chatId, messageId };

  if (data === GUEST_CALLBACKS.main || data === GUEST_CALLBACKS.begin) {
    await ack();
    await renderMainMenu(chatId, '', messageId);
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheet) {
    await ack();
    if (await hasReceivedCheatsheet(admin, telegramId)) {
      await editGuestMessage(message, 'Вы уже получали спонсорскую помощь. Получить ещё раз?', {
        inline_keyboard: [
          [{ text: '📕 Получить ещё раз', callback_data: GUEST_CALLBACKS.cheatsheetAgain }],
          [mainMenuButton()],
        ],
      });
    } else {
      await sendCheatsheet(admin, message, telegramId);
    }
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheetAgain) {
    await ack();
    await sendCheatsheet(admin, message, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinar) {
    await ack();
    await renderWebinarFlow(admin, message, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinarRegister) {
    await ack();
    await registerForWebinar(admin, message, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.when) {
    await ack();
    await showWebinarDate(admin, message);
    return true;
  }

  if (data === GUEST_CALLBACKS.channel) {
    await ack();
    await showChannel(message);
    return true;
  }

  return false;
}
