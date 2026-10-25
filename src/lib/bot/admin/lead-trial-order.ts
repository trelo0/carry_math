import type { SupabaseClient } from '@supabase/supabase-js';
import { createPurchaseRequest, findPaidTrialOrderForLead, getPurchaseRequest, type PurchaseRequestRow } from '@/lib/bot/purchase-requests';
import { sendPurchaseRequestPaymentLink } from '@/lib/bot/purchase-order-pay';
import { resolveTrialPriceByn } from './lead-trial';
import type { LeadRow } from './leads';
import { logLeadEvent } from './lead-events';

export async function findPendingTrialOrderForLead(
  admin: SupabaseClient,
  leadId: string,
): Promise<PurchaseRequestRow | null> {
  const { data, error } = await admin
    .from('purchase_requests')
    .select('id, status, lead_id, order_kind, created_at, telegram_id, product, title, amount_byn, package_index, teacher_id, resolved_at, resolved_by, course_slug, scenario, bepaid_transaction_uid, processing_version, processing_updated_at, lessons_count, lesson_format, group_id, service_description, teacher_telegram_id, lessons_delivered')
    .eq('lead_id', leadId)
    .eq('order_kind', 'trial')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as PurchaseRequestRow | null) ?? null;
}

export async function createTrialOrderForLead(
  admin: SupabaseClient,
  input: {
    lead: LeadRow;
    clientTelegramId: number;
    lessonFormat: 'individual' | 'group';
    amountByn: number;
    teacherId: string | null;
    teacherTelegramId: number | null;
    groupId?: number | null;
    subject: string;
    actorTelegramId: number;
  },
): Promise<PurchaseRequestRow> {
  const title = `Пробное · ${input.lessonFormat === 'group' ? 'группа' : 'индив.'} · ${input.subject}`;
  const request = await createPurchaseRequest(admin, {
    telegramId: input.clientTelegramId,
    product: 'trial',
    packageIndex: 0,
    teacherId: input.teacherId,
    title,
    amountByn: input.amountByn,
    lessonsCount: 1,
    leadId: input.lead.id,
    orderKind: 'trial',
    lessonFormat: input.lessonFormat,
    groupId: input.groupId ?? null,
    serviceDescription: input.subject,
    teacherTelegramId: input.teacherTelegramId,
  });
  await logLeadEvent(admin, {
    leadId: input.lead.id,
    eventType: 'trial_payment_requested',
    actorTelegramId: input.actorTelegramId,
    detail: { request_id: request.id, amount_byn: input.amountByn, format: input.lessonFormat },
  });
  await sendPurchaseRequestPaymentLink(admin, request);
  return request;
}

export async function getTrialOrderContext(
  admin: SupabaseClient,
  leadId: string,
): Promise<{ paid: PurchaseRequestRow | null; pending: PurchaseRequestRow | null }> {
  const [paid, pending] = await Promise.all([
    findPaidTrialOrderForLead(admin, leadId),
    findPendingTrialOrderForLead(admin, leadId),
  ]);
  return { paid, pending };
}

export async function resendTrialOrderPayment(
  admin: SupabaseClient,
  requestId: string,
): Promise<void> {
  const request = await getPurchaseRequest(admin, requestId);
  if (!request || request.order_kind !== 'trial') throw new Error('Заказ не найден');
  if (request.status !== 'pending') throw new Error('Заказ уже оплачен или закрыт');
  await sendPurchaseRequestPaymentLink(admin, request);
}
