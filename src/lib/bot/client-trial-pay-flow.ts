import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  buildTrialPayTelegramUrl,
  fulfillTrialPaymentByExternalId,
  getPendingTrialPaymentByExternalId,
  notifyAdminsTrialPaid,
  notifyClientTrialConfirmed,
} from '@/lib/bot/admin/lead-payments';
import { resolveMemberChatId } from '@/lib/bot/staff/messaging';
import { getLead, LEAD_SELECT_COLUMNS, setLeadStatus } from '@/lib/bot/admin/leads';

export function parseTrialPayStart(source: string): string | null {
  if (!source.startsWith('pay_trial_')) return null;
  const id = source.slice('pay_trial_'.length).trim();
  return id.length >= 8 ? id : null;
}

export function isClientTrialPayAction(data: string): boolean {
  return data.startsWith('cl:trial:');
}

async function formatLessonWhen(admin: SupabaseClient, lessonId: number): Promise<{
  subject: string;
  teacherName: string;
  whenLabel: string;
  clientName: string;
  leadCallback: string;
} | null> {
  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('topic, starts_at, teacher_telegram_id, lead_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (!lesson) return null;
  const whenLabel = new Date(lesson.starts_at as string).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  let teacherName = '—';
  if (lesson.teacher_telegram_id) {
    const { data: m } = await admin
      .from('bot_members')
      .select('full_name')
      .eq('telegram_id', lesson.teacher_telegram_id)
      .maybeSingle();
    teacherName = (m as { full_name: string | null } | null)?.full_name?.trim() || teacherName;
  }
  const leadId = lesson.lead_id as string | null;
  let clientName = 'Клиент';
  if (leadId) {
    const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
    if (lead) clientName = lead.name;
  }
  return {
    subject: lesson.topic as string,
    teacherName,
    whenLabel,
    clientName,
    leadCallback: leadId ? `al:l:${leadId}:w:0` : 'al:menu',
  };
}

export async function handleTrialPayDeepLink(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  externalId: string,
): Promise<void> {
  const payment = await getPendingTrialPaymentByExternalId(admin, externalId);
  if (!payment) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Платёж не найден или уже закрыт. Напишите администратору.',
    });
    return;
  }
  if (payment.telegram_id !== telegramId) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Эта ссылка оплаты привязана к другому аккаунту Telegram.',
    });
    return;
  }

  const acquiringUrl = process.env.PAYMENT_ACQUIRING_URL?.trim();
  const payLink = acquiringUrl
    ? acquiringUrl.replace('{externalId}', externalId).replace('{amount}', String(payment.amount_byn))
    : buildTrialPayTelegramUrl(externalId);

  const text = [
    '💳 Оплата пробного занятия',
    '',
    `Сумма: ${payment.amount_byn} BYN`,
    '',
    'Перейдите по кнопке для оплаты. После успешной оплаты статус обновится автоматически.',
  ].join('\n');

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: `💳 Оплатить ${payment.amount_byn} BYN`, url: payLink }],
        [{ text: '🔄 Проверить оплату', callback_data: `cl:trial:chk:${externalId}` }],
      ],
    },
  });
}

export async function handleClientTrialPayCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
): Promise<boolean> {
  if (!data.startsWith('cl:trial:chk:')) return false;
  const externalId = data.slice('cl:trial:chk:'.length);
  try {
    const result = await fulfillTrialPaymentByExternalId(admin, externalId);
    if (!result.lessonId) {
      await telegramSend('sendMessage', { chat_id: chatId, text: 'Оплата пока не поступила.' });
      return true;
    }
    if (result.leadId) await setLeadStatus(admin, result.leadId, 'in_progress', null);
    const meta = await formatLessonWhen(admin, result.lessonId);
    const clientChat = await resolveMemberChatId(admin, telegramId);
    if (clientChat && meta) {
      await notifyClientTrialConfirmed(clientChat, {
        subject: meta.subject,
        teacherName: meta.teacherName,
        whenLabel: meta.whenLabel,
      });
    }
    if (meta && result.leadId) {
      const payment = await getPendingTrialPaymentByExternalId(admin, externalId);
      await notifyAdminsTrialPaid(admin, {
        clientName: meta.clientName,
        subject: meta.subject,
        teacherName: meta.teacherName,
        whenLabel: meta.whenLabel,
        amountByn: Number(payment?.amount_byn ?? 0),
        leadCallback: meta.leadCallback,
      });
    }
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: result.alreadyFulfilled ? '✅ Оплата уже была подтверждена.' : '✅ Оплата подтверждена!',
    });
  } catch {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Не удалось проверить оплату. Попробуйте позже.',
    });
  }
  return true;
}

export async function processTrialPaymentWebhook(
  admin: SupabaseClient,
  externalId: string,
): Promise<{ ok: boolean; leadId: string | null }> {
  const result = await fulfillTrialPaymentByExternalId(admin, externalId);
  if (!result.lessonId || !result.leadId) return { ok: true, leadId: result.leadId };
  await setLeadStatus(admin, result.leadId, 'in_progress', null);
  const meta = await formatLessonWhen(admin, result.lessonId);
  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('telegram_id')
    .eq('id', result.lessonId)
    .maybeSingle();
  const tgId = lesson?.telegram_id as number | undefined;
  if (tgId && meta) {
    const chatId = await resolveMemberChatId(admin, tgId);
    if (chatId) {
      await notifyClientTrialConfirmed(chatId, {
        subject: meta.subject,
        teacherName: meta.teacherName,
        whenLabel: meta.whenLabel,
      });
    }
  }
  if (meta) {
    const payment = await getPendingTrialPaymentByExternalId(admin, externalId);
    await notifyAdminsTrialPaid(admin, {
      clientName: meta.clientName,
      subject: meta.subject,
      teacherName: meta.teacherName,
      whenLabel: meta.whenLabel,
      amountByn: Number(payment?.amount_byn ?? 0),
      leadCallback: meta.leadCallback,
    });
  }
  return { ok: true, leadId: result.leadId };
}
