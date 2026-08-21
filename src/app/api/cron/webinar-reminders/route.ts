import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { telegramSend } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type ReminderType = '3_days' | '1_day' | '3_hours' | '15_minutes';

type Webinar = {
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

const REMINDER_DEFINITIONS: ReminderDefinition[] = [
  { type: '3_days', offsetMs: 3 * 24 * 60 * 60 * 1000 },
  { type: '1_day', offsetMs: 24 * 60 * 60 * 1000 },
  { type: '3_hours', offsetMs: 3 * 60 * 60 * 1000 },
  { type: '15_minutes', offsetMs: 15 * 60 * 1000 },
];

// Запуск раз в пять минут и этот интервал позволяют догнать короткую задержку cron,
// но не отправлять напоминание заранее.
const REMINDER_GRACE_PERIOD_MS = 15 * 60 * 1000;

function isReminderType(value: string | null): value is ReminderType {
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

function formatWebinarDateTime(raw: string): { date: string; time: string } {
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

function reminderText(webinar: Webinar, reminderType: ReminderType): string {
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);

  if (reminderType === '3_days') {
    return `🔔 Напоминание о вебинаре\n\nЧерез 3 дня состоится бесплатный вебинар «${webinar.title}».\n\n📅 ${date}\n🕐 ${time}`;
  }

  if (reminderType === '1_day') {
    return `🔔 Уже завтра!\n\nЗавтра состоится бесплатный вебинар «${webinar.title}».\n\n📅 ${date}\n🕐 ${time}`;
  }

  if (reminderType === '3_hours') {
    return `🔔 Вебинар уже скоро!\n\nЧерез 3 часа начинается бесплатный вебинар «${webinar.title}».`;
  }

  return '🔔 Вебинар начинается через 15 минут!';
}

function webinarUrlKeyboard(url: string | null): { inline_keyboard: Array<Array<Record<string, string>>> } | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return undefined;
  } catch {
    return undefined;
  }

  return {
    inline_keyboard: [[{ text: '🔗 ОТКРЫТЬ СТРАНИЦУ ВЕБИНАРА', url }]],
  };
}

async function claimReminder(
  admin: ReturnType<typeof createAdminClient>,
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
  admin: ReturnType<typeof createAdminClient>,
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

  if (error) {
    console.error('Не удалось снять резервирование напоминания:', error);
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const forcedReminderType = url.searchParams.get('force');
  const webinarIdFilter = url.searchParams.get('webinar_id');
  if (forcedReminderType && !isReminderType(forcedReminderType)) {
    return NextResponse.json(
      { error: 'force must be one of: 3_days, 1_day, 3_hours, 15_minutes' },
      { status: 400 },
    );
  }

  const now = new Date();
  const admin = createAdminClient();
  let webinarsQuery = admin
    .from('webinars')
    .select('id, title, webinar_date, registration_url')
    .eq('is_active', true)
    .gt('webinar_date', now.toISOString());

  if (webinarIdFilter) {
    webinarsQuery = webinarsQuery.eq('id', webinarIdFilter);
  }

  const { data: rawWebinars, error: webinarsError } = await webinarsQuery;
  if (webinarsError) throw webinarsError;

  const webinars = (rawWebinars ?? []) as Webinar[];
  const summary = {
    processedWebinars: webinars.length,
    attempted: 0,
    sent: 0,
    skippedAlreadySent: 0,
    skippedInvalidRecipient: 0,
    failed: 0,
  };

  for (const webinar of webinars) {
    const webinarDate = new Date(webinar.webinar_date);
    if (Number.isNaN(webinarDate.getTime())) {
      console.error('Пропущен вебинар с некорректной датой:', webinar.id);
      continue;
    }

    const dueReminders = forcedReminderType
      ? REMINDER_DEFINITIONS.filter((definition) => definition.type === forcedReminderType)
      : REMINDER_DEFINITIONS.filter((definition) => isDue(now, webinarDate, definition));

    if (dueReminders.length === 0) continue;

    const { data: rawRegistrations, error: registrationsError } = await admin
      .from('webinar_registrations')
      .select('telegram_id')
      .eq('webinar_id', webinar.id);
    if (registrationsError) {
      console.error('Не удалось получить регистрации вебинара:', webinar.id, registrationsError);
      summary.failed += 1;
      continue;
    }

    const telegramIds = Array.from(
      new Set(
        ((rawRegistrations ?? []) as Registration[])
          .map((registration) => safePositiveInteger(registration.telegram_id))
          .filter((telegramId): telegramId is number => telegramId !== null),
      ),
    );

    if (telegramIds.length === 0) continue;

    const { data: rawMembers, error: membersError } = await admin
      .from('bot_members')
      .select('telegram_id, chat_id')
      .in('telegram_id', telegramIds);
    if (membersError) {
      console.error('Не удалось получить Telegram-чаты участников:', membersError);
      summary.failed += telegramIds.length;
      continue;
    }

    const chatIdByTelegramId = new Map<number, number>();
    for (const member of (rawMembers ?? []) as Member[]) {
      const telegramId = safePositiveInteger(member.telegram_id);
      const chatId = safePositiveInteger(member.chat_id);
      if (telegramId !== null && chatId !== null) {
        chatIdByTelegramId.set(telegramId, chatId);
      }
    }

    for (const definition of dueReminders) {
      for (const telegramId of telegramIds) {
        const chatId = chatIdByTelegramId.get(telegramId) ?? telegramId;
        if (!safePositiveInteger(chatId)) {
          summary.skippedInvalidRecipient += 1;
          continue;
        }

        summary.attempted += 1;
        const webinarId = String(webinar.id);

        try {
          // Уникальная запись создаётся до Bot API-вызова, чтобы параллельные/double cron
          // не отправили одно и то же напоминание дважды. При ошибке отправки она удаляется.
          const claimed = await claimReminder(admin, webinarId, telegramId, definition.type);
          if (!claimed) {
            summary.skippedAlreadySent += 1;
            continue;
          }

          const response = await telegramSend('sendMessage', {
            chat_id: chatId,
            text: reminderText(webinar, definition.type),
            reply_markup: webinarUrlKeyboard(webinar.registration_url),
          });

          if (!response.ok) {
            await releaseReminderClaim(admin, webinarId, telegramId, definition.type);
            summary.failed += 1;
            console.error('Telegram не принял напоминание:', {
              webinarId,
              telegramId,
              reminderType: definition.type,
              description: response.description,
            });
            continue;
          }

          summary.sent += 1;
        } catch (error) {
          await releaseReminderClaim(admin, webinarId, telegramId, definition.type);
          summary.failed += 1;
          console.error('Ошибка отправки напоминания пользователю:', {
            webinarId,
            telegramId,
            reminderType: definition.type,
            error,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), forcedReminderType, ...summary });
}
