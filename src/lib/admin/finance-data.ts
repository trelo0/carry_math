import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchFinanceHubSnapshot,
  fetchReportSnapshot,
  formatPaymentDisplayId,
  listPayments,
  periodBounds,
  type PaymentRow,
} from '@/lib/bot/admin/finance-data';
import {
  countPendingPurchaseRequests,
  isPurchaseRequestTableError,
  listPendingPurchaseRequests,
  type PurchaseRequestRow,
} from '@/lib/bot/purchase-requests';

export type AdminPurchaseFilter = 'pending' | 'all';
export type AdminFinancePeriod = 'today' | '7d' | '30d' | 'month';

export {
  fetchFinanceHubSnapshot,
  fetchReportSnapshot,
  formatPaymentDisplayId,
  periodBounds,
  type PaymentRow,
};

export async function listAdminPurchaseRequests(
  admin: SupabaseClient,
  filter: AdminPurchaseFilter,
  limit = 100,
): Promise<PurchaseRequestRow[]> {
  if (filter === 'pending') return listPendingPurchaseRequests(admin, limit);
  const { data, error } = await admin
    .from('purchase_requests')
    .select(
      'id, created_at, resolved_at, telegram_id, product, package_index, teacher_id, title, amount_byn, status, resolved_by, course_slug, scenario, bepaid_transaction_uid, processing_version, processing_updated_at, lessons_count',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isPurchaseRequestTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as PurchaseRequestRow[];
}

export async function countAdminPendingPurchaseRequests(admin: SupabaseClient): Promise<number> {
  try {
    return await countPendingPurchaseRequests(admin);
  } catch (error) {
    if (isPurchaseRequestTableError(error)) return 0;
    throw error;
  }
}

export async function loadAdminMemberBrief(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ name: string | null; phone: string | null }> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  return {
    name: (member?.full_name as string | null) ?? null,
    phone: (link?.phone as string | null) ?? (member?.phone as string | null) ?? null,
  };
}

export function formatAdminMemberLine(brief: { name: string | null; phone: string | null }, telegramId: number): string {
  if (brief.name && brief.phone) return `${brief.name} · ${brief.phone}`;
  if (brief.name) return brief.name;
  if (brief.phone) return brief.phone;
  return `ID ${telegramId}`;
}

export async function listAdminPaymentsForPeriod(
  admin: SupabaseClient,
  period: AdminFinancePeriod,
  status: 'paid' | 'pending' | 'failed' = 'paid',
): Promise<PaymentRow[]> {
  const { fromIso, toIso } = periodBounds(period);
  return listPayments(admin, {
    status,
    fromIso: status === 'paid' ? fromIso : undefined,
    toIso: status === 'paid' ? toIso : undefined,
    limit: 150,
  });
}

export function paymentStatusLabel(status: string | null): string {
  if (status === 'paid') return 'Оплачен';
  if (status === 'pending') return 'Ожидает';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменён';
  if (status === 'refunded') return 'Возврат';
  return status ?? '—';
}

export function purchaseStatusLabel(status: PurchaseRequestRow['status']): string {
  if (status === 'pending') return 'Ожидает';
  if (status === 'approved') return 'Подтверждена';
  if (status === 'rejected') return 'Отклонена';
  if (status === 'processing') return 'В обработке';
  return status;
}
