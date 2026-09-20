import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessProduct } from './accesses';

export type PurchaseRequestStatus = 'pending' | 'approved' | 'rejected';

export type PurchaseRequestRow = {
  id: string;
  created_at: string;
  resolved_at: string | null;
  telegram_id: number;
  product: AccessProduct;
  package_index: number;
  teacher_id: string | null;
  title: string;
  amount_byn: number;
  status: PurchaseRequestStatus;
  resolved_by: number | null;
};

const REQUEST_COLUMNS =
  'id, created_at, resolved_at, telegram_id, product, package_index, teacher_id, title, amount_byn, status, resolved_by';

export function isPurchaseRequestTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('purchase_requests') && (
    message.includes('does not exist') || message.includes('Could not find')
  );
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
    product: AccessProduct;
    packageIndex: number;
    teacherId?: string | null;
    title: string;
    amountByn: number;
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
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw error;
  return data as PurchaseRequestRow;
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
