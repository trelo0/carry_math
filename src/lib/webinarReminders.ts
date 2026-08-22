import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';

export type FixedReminderType = '3_days' | '1_day' | '6_hours' | '15_minutes';
export type ReminderType = FixedReminderType | `custom_${number}_minutes`;

export type ReminderWebinar = {
  id: string | number;
  title: string;
  webinar_date: string;
  registration_url: string | null;
};

export type WebinarNotificationTemplate = {
  id: number;
  webinar_id: string;
  reminder_type: ReminderType;
  offset_minutes_before: number;
  message_text: string;
  file_id: string | null;
  file_type: string | null;
  created_at: string;
  updated_at: string;
};

type Registration = {
  telegram_id: number | string | null;
};

type Member = {
  telegram_id: number | string;
  chat_id: number | string | null;
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
  skippedMissingTemplate: number;
  failed: number;
  due: Array<{
    webinarId: string;
    title: string;
    reminderType: ReminderType;
    offsetMinutesBefore: number;
    recipients: number;
  }>;
};

export const FIXED_REMINDER_OFFSETS: Record<FixedReminderType, number> = {
  '3_days': 3 * 24 * 60,
  '1_day': 24 * 60,
  '6_hours': 6 * 60,
  '15_minutes': 15,
};

const REMINDER_GRACE_PERIOD_MS = 15 * 60 * 1000;

export function isReminderType(value: string | null | undefined): value is ReminderType {
  return (
    value === '3_days' ||
    value === '1_day' ||
    value === '6_hours' ||
    value === '15_minutes' ||
    /^custom_[1-9][0-9]*_minutes$/.test(value ?? '')
  );
}

function isFixedReminderType(value: ReminderType): value is FixedReminderType {
  return value in FIXED_REMINDER_OFFSETS;
}

export function customReminderType(offsetMinutesBefore: number): ReminderType {
  return `custom_${offsetMinutesBefore}_minutes` as ReminderType;
}

function safePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatReminderOffset(offsetMinutesBefore: number): string {
  if (offsetMinutesBefore % (24 * 60) === 0) {
    const days = offsetMinutesBefore / (24 * 60);
    return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  if (offsetMinutesBefore % 60 === 0) {
    const hours = offsetMinutesBefore / 60;
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  }
  return `${offsetMinutesBefore} ${plural(offsetMinutesBefore, 'минуту', 'минуты', 'минут')}`;
}

export function reminderTypeLabel(
  reminderType: ReminderType,
  offsetMinutesBefore?: number,
): string {
  const labels: Record<FixedReminderType, string> = {
    '3_days': 'За 3 дня',
    '1_day': 'За 1 день',
    '6_hours': 'За 6 часов',
    '15_minutes': 'За 15 минут',
  };
  if (isFixedReminderType(reminderType)) return labels[reminderType];

  const offset = offsetMinutesBefore ?? Number(reminderType.match(/^custom_(\d+)_minutes$/)?.[1]);
  return Number.isFinite(offset) && offset > 0 ? `За ${formatReminderOffset(offset)}` : 'Произвольное время';
}

function isDue(now: Date, webinarDate: Date, offsetMinutesBefore: number): boolean {
  const reminderAt = webinarDate.getTime() - offsetMinutesBefore * 60 * 1000;
  const elapsedSinceReminder = now.getTime() - reminderAt;
  return elapsedSinceReminder >= 0 && elapsedSinceReminder < REMINDER_GRACE_PERIOD_MS;
}

function isTemplateTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('webinar_notification_templates') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function templateMigrationError(): Error {
  return new Error(
    'Не применена SQL-миграция supabase/webinar_notification_templates.sql для шаблонов уведомлений.',
  );
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

function renderTemplateText(templateText: string, webinar: ReminderWebinar): string {
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  return templateText
    .replaceAll('{{webinar_title}}', webinar.title)
    .replaceAll('{{webinar_date}}', date)
    .replaceAll('{{webinar_time}}', time);
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
    inline_keyboard: [[{ text: '🚀 ВОЙТИ НА АРЕНУ DISTRICT', url }]],
  };
}

export async function listWebinarNotificationTemplates(
  admin: SupabaseClient,
  webinarId: string | number,
): Promise<WebinarNotificationTemplate[]> {
  const { data, error } = await admin
    .from('webinar_notification_templates')
    .select('id, webinar_id, reminder_type, offset_minutes_before, message_text, file_id, file_type, created_at, updated_at')
    .eq('webinar_id', String(webinarId))
    .order('offset_minutes_before', { ascending: false });
  if (error) {
    if (isTemplateTableError(error)) throw templateMigrationError();
    throw error;
  }
  return (data ?? []) as WebinarNotificationTemplate[];
}

export async function getWebinarNotificationTemplate(
  admin: SupabaseClient,
  webinarId: string | number,
  reminderType: ReminderType,
): Promise<WebinarNotificationTemplate | null> {
  const { data, error } = await admin
    .from('webinar_notification_templates')
    .select('id, webinar_id, reminder_type, offset_minutes_before, message_text, file_id, file_type, created_at, updated_at')
    .eq('webinar_id', String(webinarId))
    .eq('reminder_type', reminderType)
    .maybeSingle();
  if (error) {
    if (isTemplateTableError(error)) throw templateMigrationError();
    throw error;
  }
  return data ? (data as WebinarNotificationTemplate) : null;
}

export async function saveWebinarNotificationTemplate(
  admin: SupabaseClient,
  input: {
    webinarId: string | number;
    reminderType: ReminderType;
    offsetMinutesBefore?: number;
    messageText?: string;
    fileId?: string | null;
    fileType?: string | null;
  },
): Promise<void> {
  const existing = await getWebinarNotificationTemplate(admin, input.webinarId, input.reminderType);
  const offsetMinutesBefore =
    input.offsetMinutesBefore ??
    existing?.offset_minutes_before ??
    (isFixedReminderType(input.reminderType) ? FIXED_REMINDER_OFFSETS[input.reminderType] : null);

  if (!safePositiveInteger(offsetMinutesBefore)) {
    throw new Error('Для уведомления нужно указать корректное количество минут до начала вебинара.');
  }

  const { error } = await admin.from('webinar_notification_templates').upsert(
    {
      webinar_id: String(input.webinarId),
      reminder_type: input.reminderType,
      offset_minutes_before: offsetMinutesBefore,
      message_text: input.messageText ?? existing?.message_text ?? '',
      file_id: input.fileId ?? existing?.file_id ?? null,
      file_type: input.fileType ?? existing?.file_type ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'webinar_id,reminder_type' },
  );
  if (error) {
    if (isTemplateTableError(error)) throw templateMigrationError();
    if (error.code === '23505') {
      throw new Error('У этого вебинара уже есть уведомление на такое время до начала.');
    }
    throw error;
  }
}

export async function createCustomWebinarNotificationTemplate(
  admin: SupabaseClient,
  webinarId: string | number,
  offsetMinutesBefore: number,
): Promise<WebinarNotificationTemplate> {
  const offset = safePositiveInteger(offsetMinutesBefore);
  if (!offset) throw new Error('Введите целое положительное число минут до начала вебинара.');

  const templates = await listWebinarNotificationTemplates(admin, webinarId);
  if (templates.some((template) => template.offset_minutes_before === offset)) {
    throw new Error('У этого вебинара уже есть уведомление на такое время до начала.');
  }

  const reminderType = customReminderType(offset);
  await saveWebinarNotificationTemplate(admin, {
    webinarId,
    reminderType,
    offsetMinutesBefore: offset,
    messageText: '',
  });

  const template = await getWebinarNotificationTemplate(admin, webinarId, reminderType);
  if (!template) throw new Error('Не удалось создать шаблон уведомления.');
  return template;
}

export async function removeWebinarNotificationTemplateFile(
  admin: SupabaseClient,
  webinarId: string | number,
  reminderType: ReminderType,
): Promise<void> {
  const { error } = await admin
    .from('webinar_notification_templates')
    .update({ file_id: null, file_type: null, updated_at: new Date().toISOString() })
    .eq('webinar_id', String(webinarId))
    .eq('reminder_type', reminderType);
  if (error) {
    if (isTemplateTableError(error)) throw templateMigrationError();
    throw error;
  }
}

async function sendWebinarReminder(
  chatId: number,
  webinar: ReminderWebinar,
  template: WebinarNotificationTemplate,
): Promise<void> {
  const response = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: renderTemplateText(template.message_text, webinar),
    reply_markup: webinarUrlKeyboard(webinar.registration_url, template.reminder_type),
  });
  if (!response.ok) throw new Error(response.description ?? 'Telegram не принял напоминание.');

  if (template.file_id) {
    const fileResponse = await telegramSend('sendDocument', {
      chat_id: chatId,
      document: template.file_id,
    });
    if (!fileResponse.ok) {
      throw new Error(fileResponse.description ?? 'Telegram не принял прикреплённый файл уведомления.');
    }
  }
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

  const template = await getWebinarNotificationTemplate(admin, webinar.id, reminderType);
  if (!template?.message_text.trim()) {
    throw new Error('Для этого времени нет сохранённого текста. Откройте «🔔 Уведомления» и добавьте шаблон.');
  }

  await sendWebinarReminder(chatId, webinar, template);
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
    skippedMissingTemplate: 0,
    failed: 0,
    due: [],
  };

  for (const webinar of (rawWebinars ?? []) as ReminderWebinar[]) {
    const webinarDate = new Date(webinar.webinar_date);
    if (Number.isNaN(webinarDate.getTime())) {
      console.error('Пропущен вебинар с некорректной датой:', webinar.id);
      continue;
    }

    try {
      const [templates, recipientResult] = await Promise.all([
        listWebinarNotificationTemplates(admin, webinar.id),
        getRecipients(admin, webinar.id),
      ]);
      const { recipients, invalidCount } = recipientResult;
      summary.skippedInvalidRecipient += invalidCount;

      const dueTemplates = options.forcedReminderType
        ? templates.filter((template) => template.reminder_type === options.forcedReminderType)
        : templates.filter((template) => isDue(now, webinarDate, template.offset_minutes_before));

      for (const template of dueTemplates) {
        if (!template.message_text.trim()) {
          summary.skippedMissingTemplate += recipients.length;
          console.warn('Пропущено напоминание без текста шаблона:', {
            webinarId: webinar.id,
            reminderType: template.reminder_type,
          });
          continue;
        }

        summary.due.push({
          webinarId: String(webinar.id),
          title: webinar.title,
          reminderType: template.reminder_type,
          offsetMinutesBefore: template.offset_minutes_before,
          recipients: recipients.length,
        });

        for (const recipient of recipients) {
          if (options.dryRun) {
            if (await wasReminderSent(admin, String(webinar.id), recipient.telegramId, template.reminder_type)) {
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
            template.reminder_type,
          );
          if (!claimed) {
            summary.skippedAlreadySent += 1;
            continue;
          }

          try {
            await sendWebinarReminder(recipient.chatId, webinar, template);
            summary.sent += 1;
          } catch (error) {
            await releaseReminderClaim(admin, String(webinar.id), recipient.telegramId, template.reminder_type);
            summary.failed += 1;
            console.error('Ошибка отправки напоминания пользователю:', {
              webinarId: webinar.id,
              telegramId: recipient.telegramId,
              reminderType: template.reminder_type,
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
