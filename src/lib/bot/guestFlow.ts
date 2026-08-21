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

export type ActiveWebinar = {
  id: string | number;
  title: string;
  description: string | null;
  webinar_date: string;
  registration_url: string | null;
  is_active: boolean;
};

type GuestMessage = {
  chatId: number;
  messageId: number;
};

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

const GUEST_WELCOME_TEXT =
  '🛰 ИДЕНТИФИКАЦИЯ ПРОЙДЕНА\n\n' +
  'РАНГ: КАНДИДАТ АРЕНЫ DISTRICT\n\n' +
  'Привет! 👋\n\n' +
  'Система зафиксировала твой сигнал. Ты официально попал в закрытый бункер школы «District».\n\n' +
  'Здесь мы не зубрим школьную теорию — мы учимся выживать на ЦТ/ЦЭ 2027 по математике. 🧠⚡\n\n' +
  'Твой спонсорский подарок уже укомплектован и ждёт тебя.\n\n' +
  '🎒 Нажимай кнопку ниже, чтобы забрать своё снаряжение.';

const CHEATSHEET_SENDING_TEXT =
  '📦 СНАБЖЕНИЕ ДОСТАВЛЕНО\n\n' +
  'Парашют от спонсоров приземлился! 🪂\n\n' +
  'Держи свой главный чит-код:\n\n' +
  '📕 «Траектория 80+: С нуля до максимума»\n\n' +
  'Скачивай, изучай материал и помни:\n\n' +
  'это лишь 1% того снаряжения, которое мы приготовили для тебя на Арене. ⚡';

const CHEATSHEET_AFTER_TEXT =
  '🎯 СНАРЯЖЕНИЕ ПОЛУЧЕНО\n\n' +
  'Чтобы научиться обходить эти капканы в реальном бою, особенно в части Б, тебе нужен допуск к нашему главному испытанию.\n\n' +
  '🔥 БЕСПЛАТНЫЙ ОНЛАЙН-ИНТЕНСИВ С ЛИДИЕЙ ВЛАДИМИРОВНОЙ\n\n' +
  'Жми кнопку ниже и бронируй своё место в списке участников.\n\n' +
  '🎟 Система автоматически пришлёт тебе ссылку на трансляцию в день старта.';

const CHANNEL_TEXT =
  '📡 ДОСТУП К ОФЛАЙН-ТАЁЖНИКУ\n\n' +
  'Канал Лидии Владимировны — это наша тусовка, где подготовка проходит на лёгком и расслабленном вайбе.\n\n' +
  'Там тебя ждут:\n\n' +
  '🎧 утренние DJ-сеты с формулами\n' +
  '🧩 разборы задач\n' +
  '🧠 тесты и полезные материалы\n' +
  '⚡ темы, которые школьные учителя почему-то никогда не объясняют\n\n' +
  'Жми кнопку ниже и присоединяйся к своей команде.';

function getChannelUrl(): string {
  const url = process.env.LIDIA_CHANNEL_URL;
  if (!url) throw new Error('LIDIA_CHANNEL_URL is not configured');
  return url;
}

function mainMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📦 ЗАБРАТЬ СПОНСОРСКУЮ ПОМОЩЬ', callback_data: GUEST_CALLBACKS.cheatsheet }],
      [{ text: '📝 ЗАПИСАТЬСЯ НА БЕСПЛАТНЫЙ ВЕБИНАР', callback_data: GUEST_CALLBACKS.webinar }],
      [{ text: '📡 КАНАЛ ЛИДИИ', callback_data: GUEST_CALLBACKS.channel }],
    ],
  };
}

function mainMenuButton() {
  return { text: '🏠 ГЛАВНОЕ МЕНЮ', callback_data: GUEST_CALLBACKS.main };
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
    // Документ нельзя превратить в текст через editMessageText. PDF остаётся в чате,
    // поэтому для дальнейшей навигации создаём отдельный текстовый экран.
    if (result.description?.includes('message to edit')) {
      const fallback = await telegramSend('sendMessage', {
        chat_id: message.chatId,
        text,
        reply_markup: replyMarkup,
      });
      if (!fallback.ok) {
        throw new Error(fallback.description ?? 'Не удалось открыть экран навигации.');
      }
      return;
    }
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
    timeZone: 'Europe/Moscow',
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

const ALREADY_REGISTERED_TEXT =
  '✅ ПРОПУСК УЖЕ АКТИВИРОВАН\n\n' +
  'Ты уже находишься в списке участников главного испытания.\n\n' +
  'Система следит за расписанием и отправит ссылку на трансляцию прямо сюда.\n\n' +
  '📡 Не отключай уведомления бота.';

function successfulRegistrationText(webinar: ActiveWebinar): string {
  const date = new Date(webinar.webinar_date);
  const webinarDate = Number.isNaN(date.getTime())
    ? 'дата уточняется'
    : formatWebinarDate(date);

  return (
    '✅ ДОСТУП К ГЛАВНОМУ ИСПЫТАНИЮ ОТКРЫТ\n\n' +
    `Ты успешно внесён в список участников Первого бесплатного онлайн-интенсива, который состоится ${webinarDate}.\n\n` +
    '🎯 ЧТО ТЕБЯ ЖДЁТ:\n\n' +
    'Лидия Владимировна в прямом эфире разберёт протоколы всех ловушек ЦТ и поделится новыми секретными материалами.\n\n' +
    '📡 Ссылка на трансляцию прилетит прямо в этот чат за 15 минут до старта.\n\n' +
    '⚠️ Не отключай уведомления бота — система должна доставить твой пропуск вовремя.'
  );
}

async function getActiveWebinar(admin: SupabaseClient): Promise<ActiveWebinar | null> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, description, webinar_date, registration_url, is_active')
    .eq('is_active', true)
    .gt('webinar_date', new Date().toISOString())
    .order('webinar_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ActiveWebinar | null;
}

async function isTestMaskActive(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw error;
  return data?.role === 'test' && data.view_role !== null;
}

async function hasReceivedCheatsheet(
  admin: SupabaseClient,
  telegramId: number,
  isTestMode: boolean,
): Promise<boolean> {
  // Тестовая маска всегда проходит выдачу с нуля и не читает бизнес-статус пользователя.
  if (isTestMode) return false;

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
    try {
      await editGuestMessage({ chatId, messageId }, text, mainMenuKeyboard());
      return;
    } catch (error) {
      console.error('Не удалось отредактировать главное меню, создаю новое:', error);
    }
  }

  // /start или редкий fallback после ошибки редактирования создаёт текстовое меню.
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: mainMenuKeyboard(),
  });
  if (!result.ok) throw new Error(result.description ?? 'Не удалось показать главное меню.');
}

// /start использует это имя, чтобы не менять уже работающий маршрут webhook.
export async function guestStart(chatId: number, testFooter = ''): Promise<void> {
  await renderMainMenu(chatId, testFooter);
}

async function sendCheatsheet(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
  isTestMode: boolean,
): Promise<void> {
  const fileId = process.env.GUEST_PDF_FILE_ID;
  if (!fileId) {
    const error = new Error('GUEST_PDF_FILE_ID is not configured');
    console.error(error.message);
    throw error;
  }

  // Деактивируем исходное меню до отправки файла, чтобы старые кнопки не оставались активными.
  await editGuestMessage(message, CHEATSHEET_SENDING_TEXT, { inline_keyboard: [] });

  const documentResult = await telegramSend('sendDocument', {
    chat_id: message.chatId,
    document: fileId,
  });
  if (!documentResult.ok) {
    throw new Error(documentResult.description ?? 'Не удалось отправить PDF-файл.');
  }

  const confirmationResult = await telegramSend('sendMessage', {
    chat_id: message.chatId,
    text: CHEATSHEET_AFTER_TEXT,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎟 ЗАПИСАТЬСЯ НА БЕСПЛАТНЫЙ ВЕБИНАР', callback_data: GUEST_CALLBACKS.webinar }],
        [mainMenuButton()],
      ],
    },
  });
  if (!confirmationResult.ok) {
    throw new Error(confirmationResult.description ?? 'Не удалось показать подтверждение выдачи шпоры.');
  }

  if (!isTestMode) {
    await markCheatsheetReceived(admin, telegramId);
  }
}

async function renderWebinarFlow(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
  isTestMode: boolean,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(message);
    return;
  }

  // Тестер в маске всегда видит чистый интерфейс и не получает статус реальной регистрации.
  const registered = isTestMode ? false : await isRegisteredForWebinar(admin, telegramId, webinar.id);
  if (registered) {
    await editGuestMessage(message, ALREADY_REGISTERED_TEXT, {
      inline_keyboard: [
        [{ text: '📅 КОГДА ВЕБИНАР', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    });
    return;
  }

  await editGuestMessage(
    message,
    '🛰 ЗАПРОС ПРИНЯТ\n\nСистема DISTRICT начала обработку твоих данных.\n\nЧтобы подтвердить бронь места и запустить генерацию персонального пропуска на главное испытание, нажми кнопку ниже.\n\n⚠️ Мест не бесконечное количество.',
    {
      inline_keyboard: [
        [{ text: '🎟 АКТИВИРОВАТЬ ПРОПУСК', callback_data: GUEST_CALLBACKS.webinarRegister }],
        [mainMenuButton()],
      ],
    },
  );
}

async function registerForWebinar(
  admin: SupabaseClient,
  message: GuestMessage,
  telegramId: number,
  isTestMode: boolean,
): Promise<void> {
  const webinar = await getActiveWebinar(admin);
  if (!webinar) {
    await renderNoActiveWebinar(message);
    return;
  }

  if (!isTestMode && await isRegisteredForWebinar(admin, telegramId, webinar.id)) {
    await editGuestMessage(message, ALREADY_REGISTERED_TEXT, {
      inline_keyboard: [
        [{ text: '📅 КОГДА ВЕБИНАР', callback_data: GUEST_CALLBACKS.when }],
        [mainMenuButton()],
      ],
    });
    return;
  }

  if (isTestMode) {
    await editGuestMessage(message, successfulRegistrationText(webinar), {
      inline_keyboard: [
        [{ text: '📅 КОГДА ВЕБИНАР', callback_data: GUEST_CALLBACKS.when }],
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
      ? ALREADY_REGISTERED_TEXT
      : successfulRegistrationText(webinar),
    {
      inline_keyboard: [
        [{ text: '📅 КОГДА ВЕБИНАР', callback_data: GUEST_CALLBACKS.when }],
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
    ? '📅 ДАТА АКТИВНОГО ВЕБИНАРА ПОКА УТОЧНЯЕТСЯ.'
    : `📅 ВЕБИНАР СОСТОИТСЯ ${formatWebinarDate(date)}\n\n${formatTimeRemaining(date)}`;

  await editGuestMessage(message, text, { inline_keyboard: [[mainMenuButton()]] });
}

async function showChannel(message: GuestMessage): Promise<void> {
  const url = getChannelUrl();
  await editGuestMessage(message, CHANNEL_TEXT, {
    inline_keyboard: [
      [{ text: '🚀 ЗАЛЕТЕТЬ В ТГ-КАНАЛ', url }],
      [mainMenuButton()],
    ],
  });
}

// Обрабатывает произвольный текст, не нарушая текущую навигацию кнопками.
export async function handleGuestTextMessage(chatId: number): Promise<boolean> {
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: 'Для навигации по боту используйте кнопки.',
    reply_markup: { inline_keyboard: [[mainMenuButton()]] },
  });
  if (!result.ok) throw new Error(result.description ?? 'Не удалось отправить навигационное сообщение.');
  return true;
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
  const currentMessage = { chatId, messageId };
  // Значение определяется только по свежей серверной записи bot_members.
  const isTestMode = await isTestMaskActive(admin, telegramId);

  if (data === GUEST_CALLBACKS.main || data === GUEST_CALLBACKS.begin) {
    await ack();
    await renderMainMenu(currentMessage.chatId, '', currentMessage.messageId);
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheet) {
    await ack();
    if (await hasReceivedCheatsheet(admin, telegramId, isTestMode)) {
      await editGuestMessage(
        currentMessage,
        '📦 СИСТЕМА УЖЕ ВЫДАВАЛА ЭТО СНАРЯЖЕНИЕ\n\nТы уже получил «Траектория 80+: С нуля до максимума».\n\nХочешь забрать его ещё раз?',
        {
        inline_keyboard: [
          [{ text: '📕 ПОЛУЧИТЬ ЕЩЁ РАЗ', callback_data: GUEST_CALLBACKS.cheatsheetAgain }],
          [mainMenuButton()],
        ],
      });
    } else {
      await sendCheatsheet(admin, currentMessage, telegramId, isTestMode);
    }
    return true;
  }

  if (data === GUEST_CALLBACKS.cheatsheetAgain) {
    await ack();
    await sendCheatsheet(admin, currentMessage, telegramId, isTestMode);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinar) {
    await ack();
    await renderWebinarFlow(admin, currentMessage, telegramId, isTestMode);
    return true;
  }

  if (data === GUEST_CALLBACKS.webinarRegister) {
    await ack();
    await registerForWebinar(admin, currentMessage, telegramId, isTestMode);
    return true;
  }

  if (data === GUEST_CALLBACKS.when) {
    await ack();
    await showWebinarDate(admin, currentMessage);
    return true;
  }

  if (data === GUEST_CALLBACKS.channel) {
    await ack();
    await showChannel(currentMessage);
    return true;
  }

  return false;
}
