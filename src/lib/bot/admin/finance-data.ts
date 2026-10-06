import type { SupabaseClient } from '@supabase/supabase-js';
import { countPendingPurchaseRequests, listPendingPurchaseRequests } from '../purchase-requests';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

export type PaymentRow = {
  id: number;
  telegram_id: number;
  product: string;
  amount_byn: number;
  package_id: number | null;
  lead_id: string | null;
  scheduled_lesson_id: number | null;
  external_id: string | null;
  status: string | null;
  provider: string | null;
  paid_at: string | null;
  created_at: string;
};

const PAYMENT_COLUMNS =
  'id, telegram_id, product, amount_byn, package_id, lead_id, scheduled_lesson_id, external_id, status, provider, paid_at, created_at';

export function formatPaymentDisplayId(id: number): string {
  const hex = id.toString(16).toUpperCase();
  return `#PAY-${hex.length >= 5 ? hex.slice(-5) : hex.padStart(5, '0')}`;
}

export function packageEndingThreshold(): number {
  const n = Number(process.env.FINANCE_PACKAGE_ENDING_THRESHOLD ?? '2');
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

export function moscowDayBounds(date = new Date()): { fromIso: string; toIso: string; label: string } {
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const now = date.getTime();
  const mskMidnight = Math.floor((now + mskOffset) / msDay) * msDay - mskOffset;
  const from = new Date(mskMidnight);
  const to = new Date(mskMidnight + msDay);
  const label = from.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });
  return { fromIso: from.toISOString(), toIso: to.toISOString(), label };
}

export function periodBounds(preset: 'today' | '7d' | '30d' | 'month'): { fromIso: string; toIso: string; label: string } {
  const now = new Date();
  if (preset === 'today') return moscowDayBounds(now);
  const toIso = new Date().toISOString();
  const from = new Date(now);
  if (preset === '7d') from.setDate(from.getDate() - 7);
  else if (preset === '30d') from.setDate(from.getDate() - 30);
  else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  const label =
    preset === 'month'
      ? now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', month: 'long', year: 'numeric' })
      : preset === '7d'
        ? '7 дней'
        : preset === '30d'
          ? '30 дней'
          : moscowDayBounds(now).label;
  return { fromIso: from.toISOString(), toIso, label };
}

function isPaymentsSchemaError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error);
  return msg.includes('payments') && (msg.includes('does not exist') || msg.includes('42703'));
}

export async function listPayments(
  admin: SupabaseClient,
  opts: { status?: PaymentStatus | PaymentStatus[]; fromIso?: string; toIso?: string; limit?: number },
): Promise<PaymentRow[]> {
  let query = admin.from('payments').select(PAYMENT_COLUMNS).order('created_at', { ascending: false });
  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.in('status', statuses);
  }
  if (opts.fromIso) query = query.gte('created_at', opts.fromIso);
  if (opts.toIso) query = query.lt('created_at', opts.toIso);
  query = query.limit(opts.limit ?? 200);
  const { data, error } = await query;
  if (error) {
    if (isPaymentsSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []) as PaymentRow[];
}

export async function getPayment(admin: SupabaseClient, id: number): Promise<PaymentRow | null> {
  const { data, error } = await admin.from('payments').select(PAYMENT_COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    if (isPaymentsSchemaError(error)) return null;
    throw error;
  }
  return (data as PaymentRow | null) ?? null;
}

export function duePriority(payment: PaymentRow): 'red' | 'yellow' {
  if (payment.status === 'failed') return 'red';
  const ageMs = Date.now() - new Date(payment.created_at).getTime();
  if (ageMs > 3 * 86400000) return 'red';
  return 'yellow';
}

export async function fetchFinanceHubSnapshot(admin: SupabaseClient): Promise<{
  dueCount: number;
  failedCount: number;
  packagesEnding: number;
  packagesActive: number;
  packagesEnded: number;
  todayReceived: number;
  todayPaymentCount: number;
  pendingPayments: number;
}> {
  const threshold = packageEndingThreshold();
  const { fromIso, toIso } = moscowDayBounds();

  const [pendingPayments, failedPayments, paidToday, activePkgs, endingPkgs, endedPkgs, purchasePending] =
    await Promise.all([
      listPayments(admin, { status: 'pending', limit: 500 }),
      listPayments(admin, { status: 'failed', limit: 500 }),
      listPayments(admin, { status: 'paid', fromIso, toIso, limit: 500 }),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('remaining_lessons', threshold),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('remaining_lessons', threshold)
        .gt('remaining_lessons', 0),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .or('status.eq.completed,remaining_lessons.eq.0'),
      countPendingPurchaseRequests(admin).catch(() => 0),
    ]);

  const dueCount = pendingPayments.length + failedPayments.length + purchasePending;
  const todayReceived = paidToday.reduce((s, p) => s + Number(p.amount_byn), 0);

  return {
    dueCount,
    failedCount: failedPayments.length,
    packagesEnding: endingPkgs.count ?? 0,
    packagesActive: activePkgs.count ?? 0,
    packagesEnded: endedPkgs.count ?? 0,
    todayReceived,
    todayPaymentCount: paidToday.length,
    pendingPayments: pendingPayments.length + purchasePending,
  };
}

export async function listDueItems(admin: SupabaseClient): Promise<
  Array<{ kind: 'payment'; payment: PaymentRow; priority: 'red' | 'yellow' }>
> {
  const pending = [
    ...(await listPayments(admin, { status: 'pending', limit: 100 })),
    ...(await listPayments(admin, { status: 'failed', limit: 100 })),
  ];
  return pending
    .map((payment) => ({ kind: 'payment' as const, payment, priority: duePriority(payment) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'red' ? -1 : 1;
      return new Date(a.payment.created_at).getTime() - new Date(b.payment.created_at).getTime();
    });
}

export async function fetchReportSnapshot(
  admin: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<{
  received: number;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  trialPaid: number;
  packagePaid: number;
  packagesSold: number;
}> {
  const paid = await listPayments(admin, { status: 'paid', fromIso, toIso, limit: 1000 });
  const pending = await listPayments(admin, { status: 'pending', limit: 500 });
  const failed = await listPayments(admin, { status: 'failed', limit: 500 });
  let received = 0;
  let trialPaid = 0;
  let packagePaid = 0;
  let packagesSold = 0;
  for (const p of paid) {
    const amount = Number(p.amount_byn);
    received += amount;
    if (p.product === 'trial') trialPaid += amount;
    else if (p.product === 'individual' || p.product === 'group' || p.product === 'course') {
      packagePaid += amount;
      if (p.package_id) packagesSold += 1;
    }
  }
  return {
    received,
    paidCount: paid.length,
    pendingCount: pending.length,
    failedCount: failed.length,
    trialPaid,
    packagePaid,
    packagesSold,
  };
}

export async function listPendingPurchaseRequestsForDue(admin: SupabaseClient) {
  try {
    return await listPendingPurchaseRequests(admin, 50);
  } catch {
    return [];
  }
}
