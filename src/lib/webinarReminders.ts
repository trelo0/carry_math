import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';

export type ReminderType = '3_days' | '1_day' | '6_hours' | '15_minutes';

export type ReminderWebinar = {
  id: string | number;
  title: string;
  webinar_date: string;
  registration_url: string | null;
};

type Registration = {
  telegram_id: number | string | null;
};

type Member = {
  telegram_id: number | string;
  chat_id: number | string | null;
};

type ReminderDefinition = {
  type: ReminderType;
  offsetMs: number;
};

type Recipient = {
  telegramId: number;
  chatId: number;
};

export type ReminderRunSummary = {
  processedWebinars: number;
  attempted: number;
  sent: number;
  planned: number;
  skippedAlreadySent: number;
  skippedInvalidRecipient: number;
  failed: number;
  due: Array<{ webinarId: string; title: string; reminderType: ReminderType; recipients: number }>;
};

export const REMINDER_DEFINITIONS: ReminderDefinition[] = [
  { type: '3_days', offsetMs: 3 * 24 * 60 * 60 * 1000 },
  { type: '1_day', offsetMs: 24 * 60 * 60 * 1000 },
  { type: '6_hours', offsetMs: 6 * 60 * 60 * 1000 },
  { type: '15_minutes', offsetMs: 15 * 60 * 1000 },
];

const REMINDER_GRACE_PERIOD_MS = 15 * 60 * 1000;

export function isReminderType(value: string | null): value is ReminderType {
  return REMINDER_DEFINITIONS.some((definition) => definition.type === value);
}

function safePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isDue(now: Date, webinarDate: Date, definition: ReminderDefinition): boolean {
  const reminderAt = webinarDate.getTime() - definition.offsetMs;
  const elapsedSinceReminder = now.getTime() - reminderAt;
  return elapsedSinceReminder >= 0 && elapsedSinceReminder < REMINDER_GRACE_PERIOD_MS;
}

export function formatWebinarDateTime(raw: string): { date: string; time: string } {
  const value = new Date(raw);
  const options = { timeZone: 'Europe/Moscow' };

  return {
    date: new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...options,
    }).format(value),
    time: new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...options,
    }).format(value),
  };
}

export function reminderText(webinar: ReminderWebinar, reminderType: ReminderType): string {
  const { time } = formatWebinarDateTime(webinar.webinar_date);

  if (reminderType === '3_days') {
    return (
      'Внимание всем секторам!\n\n' +
      'Проверка систем жизнеобеспечения. До нашего большого бесплатного онлайн-интенсива осталось ровно 3 дня. ' +
      'Мы покажем тебе, как устроен «District» изнутри, и разберём реальные ловушки ЦТ из части Б, на которых валятся все школьники.'
    );
  }

  if (reminderType === '1_day') {
    return (
      'Спонсорский парашют для веба!\n' +
      'За 24 часа до старта\n\n' +
      `Завтра в ${time} арена «District» официально активируется. ` +
      'Чтобы ты пришёл на трансляцию заряженным, менторы приготовили для тебя микро-гайд: ' +
      '«Формулы тригонометрии, которые спасут тебя на ЦТ». Просмотри его сегодня. ' +
      'А завтра мы разберём, как эти формулы работают в реальном бою. Встречаемся завтра!'
    );
  }

  if (reminderType === '6_hours') {
    return (
      'День ИКС настал, трибут. Сбор фракции объявлен!\n\n' +
      `Сегодня в ${time} мы выходим на Арену. Готовь тетрадку, ручку и чай. ` +
      'Лидия Владимировна проведёт разбор ловушек ЦТ, после которого ты начнёшь щёлкать тригонометрию как орехи. ' +
      'Таймер запущен. Ровно через 6 часов в этом чате откроется прямой телепорт на вебинар. Будь на связи!'
    );
  }

  return (
    'Шлюзы Арены открыты!\n\n' +
    'ТЕЛЕПОРТ АКТИВИРОВАН\n\n' +
    'Все, Лидия Владимировна уже в эфире, менторы заняли свои позиции в чате поддержки. ' +
    'Мы начинаем взлом ЦТ прямо сейчас. Залетай по кнопке ниже, пока система не ограничила доступ на этот поток! ' +
    'Твои 80+ баллов начинаются здесь.'
  );
}

export function webinarUrlKeyboard(
  url: string | null,
  reminderType: ReminderType,
): { inline_keyboard: Array<Array<Record<string, string>>> } | undefined {
  if (reminderType !== '15_minutes' || !url) return undefined;

  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return undefined;
  } catch {
    return undefined;
  }

  return {
    inline_keyboard: [[{ text: 'ВХОД НА АРЕНУ DISTRICT', url }]],
  };
}

async function sendWebinarReminder(
  chatId: number,
  webinar: ReminderWebinar,
  reminderType: ReminderType,
): Promise<void> {
  if (reminderType === '1_day') {
    const guideFileId = process.env.WEBINAR_1_DAY_GUIDE_FILE_ID;
    if (guideFileId) {
      const guideResponse = await telegramSend('sendDocument', {
        chat_id: chatId,
        document: guideFileId,
        caption: '📕 Микро-гайд: «Формулы тригонометрии, которые спасут тебя на ЦТ».',
      });
      if (!guideResponse.ok) {
        throw new Error(guideResponse.description ?? 'Telegram не принял микро-гайд.');
      }
    } else {
      console.warn('WEBINAR_1_DAY_GUIDE_FILE_ID не настроен: отправляю уведомление за сутки без файла.');
    }
  }

  const response = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: reminderText(webinar, reminderType),
    reply_markup: webinarUrlKeyboard(webinar.registration_url, reminderType),
  });
  if (!response.ok) throw new Error(response.description ?? 'Telegram не принял напоминание.');
}

async function claimReminder(
  admin: SupabaseClient,
  webinarId: string,
  telegramId: number,
  reminderType: ReminderType,
): Promise<boolean> {
  const { error } = await admin.from('webinar_reminder_sends').insert({
    webinar_id: webinarId,
    telegram_id: telegramId,
    reminder_type: reminderType,
    sent_at: new Date().toISOString(),
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

async function releaseReminderClaim(
  admin: SupabaseClient,
  webinarId: string,
  telegramId: number,
  reminderType: ReminderType,
): Promise<void> {
  const { error } = await admin
    .from('webinar_reminder_sends')
    .delete()
    .eq('webinar_id', webinarId)
    .eq('telegram_id', telegramId)
    .eq('reminder_type', reminderType);

  if (error) console.error('Не удалось снять резервирование напоминания:', error);
}

async function wasReminderSent(
  admin: SupabaseClient,
  webinarId: string,
  telegramId: number,
  reminderType: ReminderType,
): Promise<boolean> {
  const { data, error } = await admin
    .from('webinar_reminder_sends')
    .select('id')
    .eq('webinar_id', webinarId)
    .eq('telegram_id', telegramId)
    .eq('reminder_type', reminderType)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function getRecipients(
  admin: SupabaseClient,
  webinarId: ReminderWebinar['id'],
): Promise<{ recipients: Recipient[]; invalidCount: number }> {
  const { data: rawRegistrations, error: registrationsError } = await admin
    .from('webinar_registrations')
    .select('telegram_id')
    .eq('webinar_id', webinarId);
  if (registrationsError) throw registrationsError;

  const telegramIds = Array.from(
    new Set(
      ((rawRegistrations ?? []) as Registration[])
        .map((registration) => safePositiveInteger(registration.telegram_id))
        .filter((telegramId): telegramId is number => telegramId !== null),
    ),
  );
  const invalidCount = (rawRegistrations ?? []).length - telegramIds.length;
  if (telegramIds.length === 0) return { recipients: [], invalidCount };

  const { data: rawMembers, error: membersError } = await admin
    .from('bot_members')
    .select('telegram_id, chat_id')
    .in('telegram_id', telegramIds);
  if (membersError) throw membersError;

  const chatIdByTelegramId = new Map<number, number>();
  for (const member of (rawMembers ?? []) as Member[]) {
    const telegramId = safePositiveInteger(member.telegram_id);
    const chatId = safePositiveInteger(member.chat_id);
    if (telegramId !== null && chatId !== null) chatIdByTelegramId.set(telegramId, chatId);
  }

  return {
    recipients: telegramIds.map((telegramId) => ({
      telegramId,
      chatId: chatIdByTelegramId.get(telegramId) ?? telegramId,
    })),
    invalidCount,
  };
}

export async function listReminderTestWebinars(admin: SupabaseClient): Promise<ReminderWebinar[]> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, webinar_date, registration_url')
    .order('webinar_date', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ReminderWebinar[];
}

export async function getReminderTestWebinar(
  admin: SupabaseClient,
  webinarId: string,
): Promise<ReminderWebinar | null> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, webinar_date, registration_url')
    .eq('id', webinarId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as ReminderWebinar) : null;
}

export async function sendReminderPreviewToAdmin(
  admin: SupabaseClient,
  adminTelegramId: number,
  webinar: ReminderWebinar,
  reminderType: ReminderType,
): Promise<void> {
  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', adminTelegramId)
    .maybeSingle();
  if (error) throw error;

  const chatId = safePositiveInteger(data?.chat_id);
  if (chatId === null) {
    throw new Error('У администратора не указан chat_id. Откройте личный чат с ботом и выполните /start.');
  }

  await sendWebinarReminder(chatId, webinar, reminderType);
}

export async function runWebinarReminderCheck(
  admin: SupabaseClient,
  options: {
    now?: Date;
    dryRun?: boolean;
    forcedReminderType?: ReminderType;
    webinarId?: string | null;
  } = {},
): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  let webinarsQuery = admin
    .from('webinars')
    .select('id, title, webinar_date, registration_url')
    .eq('is_active', true)
    .gt('webinar_date', now.toISOString());

  if (options.webinarId) webinarsQuery = webinarsQuery.eq('id', options.webinarId);

  const { data: rawWebinars, error: webinarsError } = await webinarsQuery;
  if (webinarsError) throw webinarsError;

  const summary: ReminderRunSummary = {
    processedWebinars: (rawWebinars ?? []).length,
    attempted: 0,
    sent: 0,
    planned: 0,
    skippedAlreadySent: 0,
    skippedInvalidRecipient: 0,
    failed: 0,
    due: [],
  };

  for (const webinar of (rawWebinars ?? []) as ReminderWebinar[]) {
    const webinarDate = new Date(webinar.webinar_date);
    if (Number.isNaN(webinarDate.getTime())) {
      console.error('Пропущен вебинар с некорректной датой:', webinar.id);
      continue;
    }

    const dueReminders = options.forcedReminderType
      ? REMINDER_DEFINITIONS.filter((definition) => definition.type === options.forcedReminderType)
      : REMINDER_DEFINITIONS.filter((definition) => isDue(now, webinarDate, definition));
    if (dueReminders.length === 0) continue;

    try {
      const { recipients, invalidCount } = await getRecipients(admin, webinar.id);
      summary.skippedInvalidRecipient += invalidCount;

      for (const definition of dueReminders) {
        summary.due.push({
          webinarId: String(webinar.id),
          title: webinar.title,
          reminderType: definition.type,
          recipients: recipients.length,
        });

        for (const recipient of recipients) {
          if (options.dryRun) {
            if (await wasReminderSent(admin, String(webinar.id), recipient.telegramId, definition.type)) {
              summary.skippedAlreadySent += 1;
            } else {
              summary.planned += 1;
            }
            continue;
          }

          summary.attempted += 1;
          const claimed = await claimReminder(
            admin,
            String(webinar.id),
            recipient.telegramId,
            definition.type,
          );
          if (!claimed) {
            summary.skippedAlreadySent += 1;
            continue;
          }

          try {
            await sendWebinarReminder(recipient.chatId, webinar, definition.type);
            summary.sent += 1;
          } catch (error) {
            await releaseReminderClaim(admin, String(webinar.id), recipient.telegramId, definition.type);
            summary.failed += 1;
            console.error('Ошибка отправки напоминания пользователю:', {
              webinarId: webinar.id,
              telegramId: recipient.telegramId,
              reminderType: definition.type,
              error,
            });
          }
        }
      }
    } catch (error) {
      summary.failed += 1;
      console.error('Ошибка обработки напоминаний вебинара:', webinar.id, error);
    }
  }

  return summary;
}
