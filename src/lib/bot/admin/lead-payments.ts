import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { telegramSend } from '@/lib/telegram';
import { getBaseUrlString } from '@/lib/siteUrl';
import { logLeadEvent } from './lead-events';
import type { LeadTrialLessonRow } from './lead-trial';

export type LeadTrialPaymentRow = {
  id: number;
  telegram_id: number;
  lead_id: string | null;
  scheduled_lesson_id: number | null;
  amount_byn: number;
  status: string;
  external_id: string | null;
};

function isTrialPaymentSchemaError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return message.includes('lead_id') || message.includes('scheduled_lesson_id');
}

export function buildTrialPayTelegramUrl(paymentExternalId: string): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) return getBaseUrlString();
  return `https://t.me/${username}?start=pay_trial_${paymentExternalId}`;
}

export async function createTrialPaymentRequest(
  admin: SupabaseClient,
  input: {
    leadId: string;
    lesson: LeadTrialLessonRow;
    actorTelegramId: number;
  },
): Promise<{ paymentId: number; externalId: string; payUrl: string; amountByn: number }> {
  const amountByn = Number(input.lesson.trial_price_byn ?? 15);
  const externalId = randomUUID().replace(/-/g, '').slice(0, 24);

  const { data, error } = await admin
    .from('payments')
    .insert({
      telegram_id: input.lesson.telegram_id,
      product: 'trial',
      amount_byn: amountByn,
      lead_id: input.leadId,
      scheduled_lesson_id: input.lesson.id,
      external_id: externalId,
      status: 'pending',
      provider: 'acquiring',
    })
    .select('id')
    .single();
  if (error) throw error;

  const now = new Date().toISOString();
  const { error: lessonError } = await admin
    .from('scheduled_lessons')
    .update({ trial_payment_status: 'pending', updated_at: now })
    .eq('id', input.lesson.id);
  if (lessonError && !isTrialPaymentSchemaError(lessonError)) throw lessonError;

  await logLeadEvent(admin, {
    leadId: input.leadId,
    eventType: 'trial_payment_requested',
    actorTelegramId: input.actorTelegramId,
    detail: { payment_id: data.id, amount_byn: amountByn },
  });

  return {
    paymentId: data.id as number,
    externalId,
    payUrl: buildTrialPayTelegramUrl(externalId),
    amountByn,
  };
}

export async function skipTrialPayment(
  admin: SupabaseClient,
  leadId: string,
  lessonId: number,
  actorTelegramId: number,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('scheduled_lessons')
    .update({ trial_payment_status: 'skipped', updated_at: now })
    .eq('id', lessonId);
  if (error) throw error;
  await logLeadEvent(admin, {
    leadId,
    eventType: 'trial_payment_skipped',
    actorTelegramId,
    detail: { lesson_id: lessonId },
  });
}

export async function fulfillTrialPaymentByExternalId(
  admin: SupabaseClient,
  externalId: string,
): Promise<{ alreadyFulfilled: boolean; leadId: string | null; lessonId: number | null }> {
  const { data: payment, error } = await admin
    .from('payments')
    .select('id, status, lead_id, scheduled_lesson_id, telegram_id, amount_byn')
    .eq('external_id', externalId)
    .eq('product', 'trial')
    .maybeSingle();
  if (error) throw error;
  if (!payment) throw new Error('Payment not found');

  if (payment.status === 'paid') {
    return {
      alreadyFulfilled: true,
      leadId: (payment.lead_id as string | null) ?? null,
      lessonId: (payment.scheduled_lesson_id as number | null) ?? null,
    };
  }

  const now = new Date().toISOString();
  const { error: payErr } = await admin
    .from('payments')
    .update({ status: 'paid', paid_at: now })
    .eq('id', payment.id)
    .eq('status', 'pending');
  if (payErr) throw payErr;

  const lessonId = payment.scheduled_lesson_id as number | null;
  if (lessonId) {
    await admin
      .from('scheduled_lessons')
      .update({
        trial_payment_status: 'paid',
        is_paid: true,
        updated_at: now,
      })
      .eq('id', lessonId);
  }

  const leadId = payment.lead_id as string | null;
  if (leadId) {
    await logLeadEvent(admin, {
      leadId,
      eventType: 'trial_paid',
      detail: { payment_id: payment.id, external_id: externalId },
    });
    await logLeadEvent(admin, {
      leadId,
      eventType: 'trial_confirmed',
      detail: { lesson_id: lessonId },
    });
  }

  return { alreadyFulfilled: false, leadId, lessonId };
}

export async function notifyClientTrialPaymentRequest(
  clientTelegramId: number,
  input: {
    subject: string;
    teacherName: string;
    startsAtLabel: string;
    amountByn: number;
    payUrl: string;
  },
): Promise<void> {
  const text = [
    'Вы записаны на пробное занятие! 🎓',
    '',
    `📚 ${input.subject}`,
    `👨‍🏫 ${input.teacherName}`,
    `📅 ${input.startsAtLabel}`,
    '',
    `Стоимость пробного — ${input.amountByn} BYN.`,
    '',
    'Для подтверждения записи оплатите пробное занятие:',
  ].join('\n');
  await telegramSend('sendMessage', {
    chat_id: clientTelegramId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: `💳 Оплатить ${input.amountByn} BYN`, url: input.payUrl }]],
    },
  });
}

export async function notifyClientTrialConfirmed(
  clientChatId: number,
  input: { subject: string; teacherName: string; whenLabel: string },
): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: clientChatId,
    text: [
      '✅ Пробное подтверждено!',
      '',
      `📚 ${input.subject}`,
      `👨‍🏫 ${input.teacherName}`,
      `📅 ${input.whenLabel}`,
      '',
      'До встречи! 👋',
    ].join('\n'),
  });
}

export async function notifyAdminsTrialPaid(
  admin: SupabaseClient,
  input: {
    clientName: string;
    subject: string;
    teacherName: string;
    whenLabel: string;
    amountByn: number;
    leadCallback: string;
  },
): Promise<void> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';
  const { data } = await admin.from('bot_members').select('chat_id').or(roleFilter).not('chat_id', 'is', null);
  const text = [
    '💳 Пробное оплачено',
    '',
    `${input.clientName} оплатил пробное занятие.`,
    '',
    `📚 ${input.subject}`,
    `👨‍🏫 ${input.teacherName}`,
    `📅 ${input.whenLabel}`,
    `💰 ${input.amountByn} BYN`,
    '',
    '✅ Запись подтверждена.',
  ].join('\n');
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number }).chat_id;
    if (!chatId) continue;
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: '📨 Открыть заявку', callback_data: input.leadCallback }]],
      },
    });
  }
}

export async function getPendingTrialPaymentByExternalId(
  admin: SupabaseClient,
  externalId: string,
): Promise<LeadTrialPaymentRow | null> {
  const { data, error } = await admin
    .from('payments')
    .select('id, telegram_id, lead_id, scheduled_lesson_id, amount_byn, status, external_id')
    .eq('external_id', externalId)
    .eq('product', 'trial')
    .maybeSingle();
  if (error) throw error;
  return (data as LeadTrialPaymentRow | null) ?? null;
}
