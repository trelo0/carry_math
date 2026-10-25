import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessProduct } from './accesses';

export type PurchaseRequestStatus = 'pending' | 'processing' | 'paid' | 'approved' | 'rejected';

export type PurchaseOrderKind = 'package' | 'trial';

export type PurchaseRequestRow = {
  id: string;
  created_at: string;
  resolved_at: string | null;
  telegram_id: number;
  product: AccessProduct | 'trial';
  package_index: number;
  teacher_id: string | null;
  title: string;
  amount_byn: number;
  status: PurchaseRequestStatus;
  resolved_by: number | null;
  course_slug: string | null;
  scenario: 'start_from_beginning' | 'join_current' | null;
  bepaid_transaction_uid: string | null;
  processing_version: number;
  processing_updated_at: string | null;
  lessons_count: number | null;
  lead_id: string | null;
  order_kind: PurchaseOrderKind;
  lesson_format: 'individual' | 'group' | null;
  group_id: number | null;
  service_description: string | null;
  teacher_telegram_id: number | null;
  lessons_delivered: number;
};

const REQUEST_COLUMNS =
  'id, created_at, resolved_at, telegram_id, product, package_index, teacher_id, title, amount_byn, status, resolved_by, course_slug, scenario, bepaid_transaction_uid, processing_version, processing_updated_at, lessons_count, lead_id, order_kind, lesson_format, group_id, service_description, teacher_telegram_id, lessons_delivered';

export function isPostgresUniqueViolation(error: unknown): boolean {
  return String((error as { code?: unknown })?.code ?? '') === '23505';
}

export function isPurchaseRequestTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('purchase_requests') && (
    message.includes('does not exist') || message.includes('Could not find')
  );
}

export async function listPurchaseRequestsForTelegram(
  admin: SupabaseClient,
  telegramId: number,
  limit = 15,
): Promise<PurchaseRequestRow[]> {
  const { data, error } = await admin
    .from('purchase_requests')
    .select(REQUEST_COLUMNS)
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isPurchaseRequestTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as PurchaseRequestRow[];
}

export async function getPurchaseRequest(
  admin: SupabaseClient,
  id: string,
): Promise<PurchaseRequestRow | null> {
  const { data, error } = await admin.from('purchase_requests').select(REQUEST_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as PurchaseRequestRow | null) ?? null;
}

export async function findPendingPurchaseRequest(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  packageIndex: number,
  teacherId: string | null,
): Promise<PurchaseRequestRow | null> {
  let query = admin
    .from('purchase_requests')
    .select(REQUEST_COLUMNS)
    .eq('telegram_id', telegramId)
    .eq('product', product)
    .eq('package_index', packageIndex)
    .eq('status', 'pending');
  if (teacherId) query = query.eq('teacher_id', teacherId);
  else query = query.is('teacher_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as PurchaseRequestRow | null) ?? null;
}

export async function createPurchaseRequest(
  admin: SupabaseClient,
  input: {
    telegramId: number;
    product: AccessProduct | 'trial';
    packageIndex: number;
    teacherId?: string | null;
    title: string;
    amountByn: number;
    courseSlug?: string | null;
    scenario?: 'start_from_beginning' | 'join_current' | null;
    lessonsCount?: number | null;
    leadId?: string | null;
    orderKind?: PurchaseOrderKind;
    lessonFormat?: 'individual' | 'group' | null;
    groupId?: number | null;
    serviceDescription?: string | null;
    teacherTelegramId?: number | null;
  },
): Promise<PurchaseRequestRow> {
  const { data, error } = await admin
    .from('purchase_requests')
    .insert({
      telegram_id: input.telegramId,
      product: input.product,
      package_index: input.packageIndex,
      teacher_id: input.teacherId ?? null,
      title: input.title,
      amount_byn: input.amountByn,
      status: 'pending',
      course_slug: input.courseSlug ?? null,
      scenario: input.scenario ?? null,
      lessons_count: input.lessonsCount ?? null,
      lead_id: input.leadId ?? null,
      order_kind: input.orderKind ?? 'package',
      lesson_format: input.lessonFormat ?? null,
      group_id: input.groupId ?? null,
      service_description: input.serviceDescription ?? null,
      teacher_telegram_id: input.teacherTelegramId ?? null,
      lessons_delivered: 0,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw error;
  return data as PurchaseRequestRow;
}

export async function findPaidTrialOrderForLead(
  admin: SupabaseClient,
  leadId: string,
): Promise<PurchaseRequestRow | null> {
  const { data, error } = await admin
    .from('purchase_requests')
    .select(REQUEST_COLUMNS)
    .eq('lead_id', leadId)
    .eq('order_kind', 'trial')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isPurchaseRequestTableError(error)) return null;
    throw error;
  }
  return (data as PurchaseRequestRow | null) ?? null;
}

/** Обновляет поля pending-заявки (цена, курс, сценарий) перед повторным checkout. */
export async function updatePendingPurchaseRequestDetails(
  admin: SupabaseClient,
  id: string,
  input: {
    title: string;
    amountByn: number;
    courseSlug?: string | null;
    scenario?: 'start_from_beginning' | 'join_current' | null;
    lessonsCount?: number | null;
  },
): Promise<PurchaseRequestRow | null> {
  const { data, error } = await admin
    .from('purchase_requests')
    .update({
      title: input.title,
      amount_byn: input.amountByn,
      course_slug: input.courseSlug ?? null,
      scenario: input.scenario ?? null,
      lessons_count: input.lessonsCount ?? null,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select(REQUEST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as PurchaseRequestRow | null) ?? null;
}

/**
 * Одна pending course-заявка на (telegram, product, package, teacher) — см. purchase_requests_pending_unique_idx.
 * Переиспользует или обновляет существующую вместо второго insert.
 */
export async function ensurePendingCoursePurchaseRequest(
  admin: SupabaseClient,
  input: {
    telegramId: number;
    packageIndex: number;
    title: string;
    amountByn: number;
    courseSlug?: string | null;
    scenario?: 'start_from_beginning' | 'join_current' | null;
    lessonsCount?: number | null;
  },
): Promise<PurchaseRequestRow> {
  const teacherId = null;
  const existing = await findPendingPurchaseRequest(
    admin,
    input.telegramId,
    'course',
    input.packageIndex,
    teacherId,
  );
  if (existing) {
    const updated = await updatePendingPurchaseRequestDetails(admin, existing.id, input);
    if (updated) return updated;
    throw new Error('Purchase request is no longer pending');
  }

  try {
    return await createPurchaseRequest(admin, {
      telegramId: input.telegramId,
      product: 'course',
      packageIndex: input.packageIndex,
      teacherId,
      title: input.title,
      amountByn: input.amountByn,
      courseSlug: input.courseSlug,
      scenario: input.scenario,
      lessonsCount: input.lessonsCount,
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const retry = await findPendingPurchaseRequest(
      admin,
      input.telegramId,
      'course',
      input.packageIndex,
      teacherId,
    );
    if (!retry) throw error;
    const updated = await updatePendingPurchaseRequestDetails(admin, retry.id, input);
    if (updated) return updated;
    throw error;
  }
}

export async function setPurchaseRequestStatus(
  admin: SupabaseClient,
  id: string,
  status: PurchaseRequestStatus,
  resolvedBy?: number,
): Promise<void> {
  const { error } = await admin
    .from('purchase_requests')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy ?? null,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Обновляет статус только если заявка ещё pending. Возвращает false, если уже обработана. */
export async function markPurchaseRequestResolved(
  admin: SupabaseClient,
  id: string,
  status: Exclude<PurchaseRequestStatus, 'pending'>,
  resolvedBy?: number,
): Promise<boolean> {
  // Сначала пробуем использовать SQL-функцию для атомарности
  try {
    const { data, error } = await admin.rpc('mark_purchase_request_resolved', {
      p_id: id,
      p_status: status,
      p_resolved_by: resolvedBy ?? null,
    });
    if (error) throw error;
    return data as boolean;
  } catch (error) {
    // Fallback на обычный update, если функция ещё не создана
    console.warn('[markPurchaseRequestResolved] RPC not available, using fallback:', error);
    const { data, error: updateError } = await admin
      .from('purchase_requests')
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy ?? null,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    return !!data;
  }
}

export async function listPendingPurchaseRequests(
  admin: SupabaseClient,
  limit = 50,
): Promise<PurchaseRequestRow[]> {
  const { data, error } = await admin
    .from('purchase_requests')
    .select(REQUEST_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PurchaseRequestRow[];
}

export async function listPurchaseRequestsForUser(
  admin: SupabaseClient,
  telegramId: number,
  limit = 20,
): Promise<PurchaseRequestRow[]> {
  const { data, error } = await admin
    .from('purchase_requests')
    .select(REQUEST_COLUMNS)
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PurchaseRequestRow[];
}

export async function countPendingPurchaseRequests(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('purchase_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}
