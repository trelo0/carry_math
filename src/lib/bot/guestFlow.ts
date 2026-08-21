import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getBaseUrlString } from '@/lib/siteUrl';

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

function getCheatsheetUrl(): string {
  return process.env.GUEST_PDF_URL ?? `${getBaseUrlString()}/sponsor-shpora.pdf`;
}

function mainMenuKeyboard() {
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

async function renderNoActiveWebinar(chatId: number): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: '📅 Сейчас нет активного вебинара. Следи за анонсами в канале Лидии.',
    reply_markup: { inline_keyboard: [[mainMenuButton()]] },
  });
}

// Единая точка возврата во всех сценариях гостя.
export async function renderMainMenu(chatId: number, testFooter = ''): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: GUEST_WELCOME_TEXT + testFooter,
    reply_markup: mainMenuKeyboard(),
  });
}

// /start использует это имя, чтобы не менять уже работающий маршрут webhook.
export async function guestStart(chatId: number, testFooter = ''): Promise<void> {
  await renderMainMenu(chatId, testFooter);
}

async function sendCheatsheet(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
): Promise<void> {
  await telegramSend('sendMessage', { chat_id: chatId, text: CHEATSHEET_DELIVERY_TEXT });

  const result = await telegramSend('sendDocument', {
    chat_id: chatId,
    document: getCheatsheetUrl(),
    caption: '📄 Спонсорская помощь — онлайн-школа District',
  });
  if (!result.ok) throw new Error(result.description ?? 'Не удалось отправить PDF-файл.');

  await markCheatsheetReceived(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: CHEATSHEET_AFTER_TEXT,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Записаться на бесплатный вебинар', callback_data: GUEST_CALLBACKS.webinar }],
        [mainMenuButton()],
      ],
    },
  });
}

async function renderWebinarFlow(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(chatId);
    return;
  }

  const registered = await isRegisteredForWebinar(admin, telegramId, webinar.id);
  if (registered) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '✅ Вы уже записаны на бесплатный вебинар.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
          [mainMenuButton()],
        ],
      },
    });
    return;
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: '📝 Бесплатный вебинар поможет разобраться, как подтянуть математику без зубрёжки. Займи место по кнопке ниже.',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Записаться на вебинар', callback_data: GUEST_CALLBACKS.webinarRegister }],
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    },
  });
}

async function registerForWebinar(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(chatId);
    return;
  }

  if (await isRegisteredForWebinar(admin, telegramId, webinar.id)) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '✅ Вы уже записаны на бесплатный вебинар.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
          [mainMenuButton()],
        ],
      },
    });
    return;
  }

  const { error } = await admin.from('webinar_registrations').insert({
    webinar_id: webinar.id,
    telegram_id: telegramId,
    registered_at: new Date().toISOString(),
  });

  if (error && error.code !== '23505') throw error;

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: error?.code === '23505'
      ? '✅ Вы уже записаны на бесплатный вебинар.'
      : '✅ Вы успешно записались на бесплатный вебинар!',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 Когда вебинар', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    },
  });
}

async function showWebinarDate(admin: SupabaseClient, chatId: number): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(chatId);
    return;
  }

  const date = new Date(webinar.webinar_date);
  const text = Number.isNaN(date.getTime())
    ? '📅 Дата активного вебинара пока уточняется.'
    : `📅 Вебинар состоится ${formatWebinarDate(date)}.\n${formatTimeRemaining(date)}`;

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[mainMenuButton()]] },
  });
}

async function showChannel(chatId: number): Promise<void> {
  const url = getChannelUrl();
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: CHANNEL_TEXT,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Перейти в канал', url }],
        [mainMenuButton()],
      ],
    },
  });
}

// Обработка callback-кнопок гостевого меню. Возвращает true для известных сценариев.
export async function handleGuestCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const ack = (text?: string) =>
    callbackQueryId
      ? telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
      : Promise.resolve({ ok: true });

  if (data === GUEST_CALLBACKS.main || data === GUEST_CALLBACKS.begin) {
    await ack();
    await renderMainMenu(chatId);
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheet) {
    await ack();
    if (await hasReceivedCheatsheet(admin, telegramId)) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Вы уже получали спонсорскую помощь. Получить ещё раз?',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📕 Получить ещё раз', callback_data: GUEST_CALLBACKS.cheatsheetAgain }],
            [mainMenuButton()],
          ],
        },
      });
    } else {
      await sendCheatsheet(admin, chatId, telegramId);
    }
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheetAgain) {
    await ack();
    await sendCheatsheet(admin, chatId, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinar) {
    await ack();
    await renderWebinarFlow(admin, chatId, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinarRegister) {
    await ack();
    await registerForWebinar(admin, chatId, telegramId);
    return true;
  }

  if (data === GUEST_CALLBACKS.when) {
    await ack();
    await showWebinarDate(admin, chatId);
    return true;
  }

  if (data === GUEST_CALLBACKS.channel) {
    await ack();
    await showChannel(chatId);
    return true;
  }

  return false;
}
