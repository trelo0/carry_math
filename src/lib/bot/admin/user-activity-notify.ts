import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { staffStudentLabel } from '@/lib/bot/staff/messaging';
import { adminClientTopicCallback } from './admin-dm-topic';
import { resolvePrimaryAdminTelegramId } from './admin-guest-inbox';
import { resolveMemberChatId } from '@/lib/bot/staff/messaging';

const MINSK = 'Europe/Minsk';

export type AdminUserEventKind =
  | 'first_cabinet_login'
  | 'cabinet_login'
  | 'cta_course_signup'
  | 'course_map_first_view'
  | 'trial_lesson_first_view'
  | 'checkout_started'
  | 'course_purchase_paid';

export function formatActivityDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('ru-RU', {
    timeZone: MINSK,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function line(label: string, value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return `${label} ${escapeHtml(v)}`;
}

async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }

  if (ids.size === 0) {
    const primaryId = await resolvePrimaryAdminTelegramId(admin);
    if (primaryId != null) {
      const chatId = (await resolveMemberChatId(admin, primaryId)) ?? primaryId;
      ids.add(chatId);
    }
  }

  return [...ids];
}

export type ActivityNotifyPayload = {
  kind: AdminUserEventKind;
  occurredAt: string;
  userDisplayName?: string | null;
  contactHint?: string | null;
  courseTitle?: string | null;
  lessonTitle?: string | null;
  sourceLabel?: string | null;
  checkoutAction?: string | null;
  scenarioLabel?: string | null;
  amountByn?: number | null;
  currency?: string | null;
  studentName?: string | null;
  payerName?: string | null;
};

function titleForKind(kind: AdminUserEventKind): string {
  switch (kind) {
    case 'first_cabinet_login':
      return '🎉 <b>Первый вход в личный кабинет</b>';
    case 'cabinet_login':
      return '🔐 <b>Пользователь вошёл в личный кабинет</b>';
    case 'cta_course_signup':
      return '🎯 <b>Переход к записи на курс</b>';
    case 'course_map_first_view':
      return '📚 <b>Пользователь заинтересовался курсом</b>';
    case 'trial_lesson_first_view':
      return '▶️ <b>Пользователь смотрит пробное занятие</b>';
    case 'checkout_started':
      return '🛒 <b>Пользователь начал оформление</b>';
    case 'course_purchase_paid':
      return '🎓 <b>Покупка курса</b>';
    default:
      return '<b>Уведомление</b>';
  }
}

export function formatAdminUserActivityHtml(payload: ActivityNotifyPayload): string {
  const blocks: string[] = [titleForKind(payload.kind), ''];

  const userLine =
    line('👤 <b>Пользователь:</b>', payload.userDisplayName) ??
    line('👤 <b>Ученик:</b>', payload.studentName);
  if (userLine) blocks.push(userLine);

  if (payload.payerName?.trim() && payload.payerName.trim() !== payload.userDisplayName?.trim()) {
    const payer = line('💳 <b>Плательщик:</b>', payload.payerName);
    if (payer) blocks.push(payer);
  }

  const course = line('📚 <b>Курс:</b>', payload.courseTitle);
  if (course) blocks.push(course);

  const lesson = line('📖 <b>Занятие:</b>', payload.lessonTitle);
  if (lesson) blocks.push(lesson);

  const source = line('📍 <b>Источник:</b>', payload.sourceLabel);
  if (source) blocks.push(source);

  const action = line('📋 <b>Действие:</b>', payload.checkoutAction);
  if (action) blocks.push(action);

  const scenario = line('🧭 <b>Сценарий:</b>', payload.scenarioLabel);
  if (scenario) blocks.push(scenario);

  if (payload.amountByn != null && payload.amountByn > 0) {
    const cur = payload.currency?.trim() || 'BYN';
    blocks.push(`💰 <b>Сумма:</b> ${escapeHtml(String(payload.amountByn))} ${escapeHtml(cur)}`);
  }

  const contact = line('📞 <b>Контакт:</b>', payload.contactHint);
  if (contact) blocks.push(contact);

  blocks.push('', `🕒 <b>Время:</b> ${escapeHtml(formatActivityDateTime(payload.occurredAt))}`);

  return blocks.join('\n');
}

export async function sendAdminUserActivityTelegram(
  admin: SupabaseClient,
  params: {
    textHtml: string;
    clientTelegramId: number | null;
    contactFallback?: string | null;
  },
): Promise<boolean> {
  const chatIds = await getAdminChatIds(admin);
  if (chatIds.length === 0) return false;

  const canContact = params.clientTelegramId != null && params.clientTelegramId > 0;
  const replyMarkup = canContact
    ? {
        inline_keyboard: [
          [
            {
              text: '💬 Связаться с учеником',
              callback_data: adminClientTopicCallback(params.clientTelegramId!),
            },
          ],
        ],
      }
    : params.contactFallback?.trim()
      ? undefined
      : undefined;

  let text = params.textHtml;
  if (!canContact) {
    text += '\n\n<i>Связь через бота недоступна — нет привязки Telegram.</i>';
    if (params.contactFallback?.trim()) {
      text += `\n${escapeHtml(params.contactFallback.trim())}`;
    }
  }

  let anyOk = false;
  for (const chatId of chatIds) {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML' as const,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };
    let result = await telegramSend('sendMessage', payload);
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 400));
      result = await telegramSend('sendMessage', payload);
    }
    if (result.ok) anyOk = true;
    else console.error('[user-activity-notify] send failed:', result.description);
  }
  return anyOk;
}

/** Повторная доставка событий, сохранённых в БД, но не дошедших до Telegram. */
export async function redeliverPendingAdminUserEventNotifications(
  admin: SupabaseClient,
  limit = 30,
): Promise<{ attempted: number; delivered: number }> {
  const { data: rows, error } = await admin
    .from('admin_user_events')
    .select('id, kind, user_id, telegram_id, course_id, source, payload, occurred_at')
    .is('telegram_notified_at', null)
    .order('occurred_at', { ascending: true })
    .limit(limit);
  if (error || !rows?.length) return { attempted: 0, delivered: 0 };

  let delivered = 0;
  const { loadActivityNotificationSettings } = await import('./user-activity-settings');
  const toggles = await loadActivityNotificationSettings(admin);

  for (const row of rows) {
    const kind = row.kind as AdminUserEventKind;
    if (toggles[kind] !== true) continue;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const { displayName, contactHint } = await resolveActivityUserDisplay(
      admin,
      (row.telegram_id as number | null) ?? null,
      (row.user_id as string | null) ?? null,
    );
    const textHtml = formatAdminUserActivityHtml({
      kind,
      occurredAt: row.occurred_at as string,
      userDisplayName: displayName,
      contactHint,
      courseTitle: typeof payload.courseTitle === 'string' ? payload.courseTitle : null,
      lessonTitle: typeof payload.lessonTitle === 'string' ? payload.lessonTitle : null,
      sourceLabel:
        typeof payload.sourceLabel === 'string'
          ? payload.sourceLabel
          : typeof row.source === 'string'
            ? (CTA_SOURCE_LABELS[row.source] ?? row.source)
            : null,
      checkoutAction: typeof payload.checkoutAction === 'string' ? payload.checkoutAction : null,
      scenarioLabel: typeof payload.scenarioLabel === 'string' ? payload.scenarioLabel : null,
      amountByn: typeof payload.amountByn === 'number' ? payload.amountByn : null,
    });
    const sent = await sendAdminUserActivityTelegram(admin, {
      textHtml,
      clientTelegramId: (row.telegram_id as number | null) ?? null,
      contactFallback: contactHint,
    });
    if (sent) {
      delivered += 1;
      await admin
        .from('admin_user_events')
        .update({ telegram_notified_at: new Date().toISOString() })
        .eq('id', row.id);
    }
  }
  return { attempted: rows.length, delivered };
}

export async function resolveActivityUserDisplay(
  admin: SupabaseClient,
  telegramId: number | null,
  userId: string | null,
): Promise<{ displayName: string; contactHint: string | null }> {
  if (telegramId != null && telegramId > 0) {
    const label = await staffStudentLabel(admin, telegramId);
    const { data: link } = await admin
      .from('telegram_links')
      .select('phone')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    const phone = link?.phone?.trim();
    return {
      displayName: label,
      contactHint: phone ? `тел. ${phone}` : null,
    };
  }

  if (userId) {
    const { data: link } = await admin
      .from('telegram_links')
      .select('phone, telegram_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (link?.telegram_id) {
      const label = await staffStudentLabel(admin, link.telegram_id as number);
      const phone = link.phone?.trim();
      return { displayName: label, contactHint: phone ? `тел. ${phone}` : null };
    }
    const phone = link?.phone?.trim();
    if (phone) return { displayName: phone, contactHint: `тел. ${phone}` };
  }

  return { displayName: 'Ученик', contactHint: null };
}

export const CTA_SOURCE_LABELS: Record<string, string> = {
  home_hero: 'Главная — Hero',
  home_initiation: 'Главная — блок инициации',
};
