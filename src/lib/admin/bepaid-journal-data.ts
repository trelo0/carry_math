import type { SupabaseClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getJournalShopsConfig, type JournalSource, type JournalStatus } from '@/lib/bepaid/journal';

export type FinancePeriod = 'today' | '7d' | '30d' | '90d' | 'month' | 'all';
export type FinanceSourceFilter = 'all' | JournalSource;
export type FinanceMethodFilter = 'all' | 'card' | 'erip' | 'other';
export type FinanceStatusFilter = 'all' | JournalStatus;

export type FinanceFilters = {
  period: FinancePeriod;
  source: FinanceSourceFilter;
  method: FinanceMethodFilter;
  status: FinanceStatusFilter;
  q: string;
  page: number;
};

export const FINANCE_PAGE_SIZE = 10;
const ROW_LIMIT = 20000;
const MSK_OFFSET = 3 * 3600_000;
const DAY = 86_400_000;

export type FinanceListRow = {
  uid: string;
  source: JournalSource;
  kind: 'payment' | 'refund';
  status: JournalStatus;
  amount_minor: number;
  currency: string;
  payer_name: string | null;
  product_title: string | null;
  payment_method: string | null;
  is_test: boolean;
  occurred_at: string;
};

export type CurrencyTotal = { currency: string; amountMinor: number };

export type FinanceChartDay = { label: string; site: number; product: number };

export type FinanceDashboardData = {
  tableMissing: boolean;
  periodLabel: string;
  rangeLabel: string;
  mainShopConfigured: boolean;
  productsShopConfigured: boolean;
  lastSyncedAt: string | null;
  rows: FinanceListRow[];
  total: number;
  cards: {
    siteTotals: CurrencyTotal[];
    productTotals: CurrencyTotal[];
    allTotals: CurrencyTotal[];
    paidCount: number;
    /** Изменение к предыдущему периоду такой же длины, %; null — сравнивать не с чем. */
    deltaSite: number | null;
    deltaProduct: number | null;
    deltaAll: number | null;
    deltaCount: number | null;
  };
  extra: {
    pending: number;
    failed: number;
    cancelled: number;
    refunds: number;
    refundTotals: CurrencyTotal[];
    tests: number;
    truncated: boolean;
  };
  chart: { currency: string; days: FinanceChartDay[]; maxMinor: number };
};

const STATUSES: JournalStatus[] = ['paid', 'pending', 'failed', 'cancelled', 'refunded'];
const PERIODS: FinancePeriod[] = ['today', '7d', '30d', '90d', 'month', 'all'];

export function parseFinanceFilters(sp: Record<string, string | undefined>): FinanceFilters {
  const period = PERIODS.includes(sp.period as FinancePeriod) ? (sp.period as FinancePeriod) : '30d';
  const status = STATUSES.includes(sp.status as JournalStatus) ? (sp.status as JournalStatus) : 'all';
  const source: FinanceSourceFilter = sp.source === 'site' || sp.source === 'product' ? sp.source : 'all';
  const method: FinanceMethodFilter =
    sp.method === 'card' || sp.method === 'erip' || sp.method === 'other' ? sp.method : 'all';
  // В URL страница 1-based, внутри 0-based.
  const page = Math.max(0, (Math.trunc(Number(sp.page)) || 1) - 1);
  return { period, status, source, method, q: (sp.q ?? '').trim().slice(0, 100), page };
}

function mskMidnight(ms: number): number {
  return Math.floor((ms + MSK_OFFSET) / DAY) * DAY - MSK_OFFSET;
}

function resolvePeriod(period: FinancePeriod, now: number) {
  const today = mskMidnight(now);
  let fromMs: number | null = today;
  let label = 'Сегодня';
  let chartDays = 7;
  if (period === '7d') {
    fromMs = today - 6 * DAY;
    label = '7 дней';
    chartDays = 7;
  } else if (period === '30d') {
    fromMs = today - 29 * DAY;
    label = '30 дней';
    chartDays = 30;
  } else if (period === '90d') {
    fromMs = today - 89 * DAY;
    label = '90 дней';
    chartDays = 90;
  } else if (period === 'month') {
    const d = new Date(today + MSK_OFFSET);
    fromMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - MSK_OFFSET;
    label = 'Текущий месяц';
    chartDays = Math.max(7, Math.round((today - fromMs) / DAY) + 1);
  } else if (period === 'all') {
    fromMs = null;
    label = 'Всё время';
    chartDays = 90;
  }
  return { fromMs, label, chartDays };
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' });
}

/** Экранирование значения для PostgREST `or(...)` / ilike. */
function searchPattern(q: string): string {
  const safe = q.replace(/[%_\\,()"']/g, ' ').replace(/\s+/g, ' ').trim();
  return `%${safe}%`;
}

type Q = {
  gte: (c: string, v: string) => Q;
  lt: (c: string, v: string) => Q;
  eq: (c: string, v: string) => Q;
  or: (f: string) => Q;
};

function applyFilters<T>(
  query: T,
  f: FinanceFilters,
  opts: { fromIso?: string | null; toIso?: string | null; withMethod: boolean; withStatus: boolean },
): T {
  let q = query as unknown as Q;
  if (opts.fromIso) q = q.gte('occurred_at', opts.fromIso);
  if (opts.toIso) q = q.lt('occurred_at', opts.toIso);
  if (f.source !== 'all') q = q.eq('source', f.source);
  if (opts.withMethod && f.method !== 'all') q = q.eq('payment_method', f.method);
  if (opts.withStatus && f.status !== 'all') q = q.eq('status', f.status);
  if (f.q) {
    const p = searchPattern(f.q);
    q = q.or(`payer_name.ilike.${p},product_title.ilike.${p},uid.ilike.${p},tracking_id.ilike.${p}`);
  }
  return q as unknown as T;
}

function addTotal(list: CurrencyTotal[], currency: string, amount: number) {
  const hit = list.find((t) => t.currency === currency);
  if (hit) hit.amountMinor += amount;
  else list.push({ currency, amountMinor: amount });
}

function delta(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? 100 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

type StatRow = {
  status: JournalStatus;
  kind: 'payment' | 'refund';
  amount_minor: number;
  currency: string;
  is_test: boolean;
  source: JournalSource;
  occurred_at: string;
};

function isMissingColumn(error: { message?: string; code?: string } | null, column: string): boolean {
  return Boolean(error) && (error?.message ?? '').includes(column);
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  return Boolean(error) && (error?.code === '42P01' || /bepaid_transactions/.test(error?.message ?? ''));
}

async function loadOnce(
  admin: SupabaseClient,
  f: FinanceFilters,
  withMethod: boolean,
): Promise<FinanceDashboardData | { retryWithoutMethod: true }> {
  const config = getJournalShopsConfig();
  const now = Date.now();
  const CHART_WINDOW_DAYS = 90;
  const { fromMs, label } = resolvePeriod(f.period, now);
  const length = fromMs == null ? 0 : now - fromMs;
  const prevFromMs = fromMs == null ? null : fromMs - length;
  const chartStart = mskMidnight(now) - (CHART_WINDOW_DAYS - 1) * DAY;
  const lowerMs = fromMs == null ? null : Math.min(prevFromMs ?? fromMs, chartStart, fromMs);
  const toIso = new Date(now + 60_000).toISOString();

  const statsQuery = applyFilters(
    admin
      .from('bepaid_transactions')
      .select('status, kind, amount_minor, currency, is_test, source, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(ROW_LIMIT),
    f,
    { fromIso: lowerMs == null ? null : new Date(lowerMs).toISOString(), toIso, withMethod, withStatus: false },
  );

  const listColumns = withMethod
    ? 'uid, source, kind, status, amount_minor, currency, payer_name, product_title, payment_method, is_test, occurred_at'
    : 'uid, source, kind, status, amount_minor, currency, payer_name, product_title, is_test, occurred_at';
  const listQuery = applyFilters(
    admin
      .from('bepaid_transactions')
      .select(listColumns, { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(f.page * FINANCE_PAGE_SIZE, f.page * FINANCE_PAGE_SIZE + FINANCE_PAGE_SIZE - 1),
    f,
    {
      fromIso: fromMs == null ? null : new Date(fromMs).toISOString(),
      toIso,
      withMethod,
      withStatus: true,
    },
  );

  const lastQuery = admin
    .from('bepaid_transactions')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1);

  const [statsRes, listRes, lastRes] = await Promise.all([statsQuery, listQuery, lastQuery]);

  const emptyCards: FinanceDashboardData['cards'] = {
    siteTotals: [],
    productTotals: [],
    allTotals: [],
    paidCount: 0,
    deltaSite: null,
    deltaProduct: null,
    deltaAll: null,
    deltaCount: null,
  };
  const base = {
    periodLabel: label,
    rangeLabel: fromMs == null ? 'за всё время' : `${shortDate(fromMs)} — ${shortDate(now)}`,
    mainShopConfigured: Boolean(config.main),
    productsShopConfigured: Boolean(config.products),
  };

  if (isMissingTable(statsRes.error) || isMissingTable(listRes.error)) {
    return {
      ...base,
      tableMissing: true,
      lastSyncedAt: null,
      rows: [],
      total: 0,
      cards: emptyCards,
      extra: { pending: 0, failed: 0, cancelled: 0, refunds: 0, refundTotals: [], tests: 0, truncated: false },
      chart: { currency: 'BYN', days: [], maxMinor: 0 },
    };
  }
  if (withMethod && (isMissingColumn(statsRes.error, 'payment_method') || isMissingColumn(listRes.error, 'payment_method'))) {
    return { retryWithoutMethod: true };
  }
  if (statsRes.error) throw statsRes.error;
  if (listRes.error) throw listRes.error;

  const statRows = (statsRes.data ?? []) as unknown as StatRow[];

  // Основная валюта графика/динамики — с наибольшим объёмом успешных оплат.
  const volume = new Map<string, number>();
  for (const r of statRows) {
    if (!r.is_test && r.status === 'paid' && r.kind === 'payment') {
      volume.set(r.currency, (volume.get(r.currency) ?? 0) + Number(r.amount_minor));
    }
  }
  const primary = [...volume.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BYN';

  const cards: FinanceDashboardData['cards'] = {
    ...emptyCards,
    siteTotals: [],
    productTotals: [],
    allTotals: [],
  };
  const extra = { pending: 0, failed: 0, cancelled: 0, refunds: 0, refundTotals: [] as CurrencyTotal[], tests: 0, truncated: statRows.length >= ROW_LIMIT };
  const prev = { site: 0, product: 0, count: 0 };
  const cur = { site: 0, product: 0, count: 0 };

  const chartDaysArr: FinanceChartDay[] = Array.from({ length: CHART_WINDOW_DAYS }, (_, i) => ({
    label: shortDate(chartStart + i * DAY + DAY / 2),
    site: 0,
    product: 0,
  }));

  for (const r of statRows) {
    const t = Date.parse(r.occurred_at);
    const inPeriod = fromMs == null || t >= fromMs;
    const inPrev = prevFromMs != null && fromMs != null && t >= prevFromMs && t < fromMs;
    const amount = Number(r.amount_minor);

    if (r.is_test) {
      if (inPeriod) extra.tests += 1;
      continue;
    }

    if (r.status === 'paid' && r.kind === 'payment') {
      if (inPeriod) {
        cards.paidCount += 1;
        addTotal(r.source === 'site' ? cards.siteTotals : cards.productTotals, r.currency, amount);
        addTotal(cards.allTotals, r.currency, amount);
        if (r.currency === primary) {
          if (r.source === 'site') cur.site += amount;
          else cur.product += amount;
        }
        cur.count += 1;
      } else if (inPrev) {
        if (r.currency === primary) {
          if (r.source === 'site') prev.site += amount;
          else prev.product += amount;
        }
        prev.count += 1;
      }
      if (r.currency === primary && t >= chartStart) {
        const idx = Math.floor((t - chartStart) / DAY);
        const day = chartDaysArr[idx];
        if (day) {
          if (r.source === 'site') day.site += amount;
          else day.product += amount;
        }
      }
      continue;
    }

    if (!inPeriod) continue;
    if (r.status === 'refunded' && r.kind === 'refund') {
      extra.refunds += 1;
      addTotal(extra.refundTotals, r.currency, amount);
    } else if (r.status === 'pending') extra.pending += 1;
    else if (r.status === 'failed') extra.failed += 1;
    else if (r.status === 'cancelled') extra.cancelled += 1;
  }

  if (fromMs != null) {
    cards.deltaSite = delta(cur.site, prev.site);
    cards.deltaProduct = delta(cur.product, prev.product);
    cards.deltaAll = delta(cur.site + cur.product, prev.site + prev.product);
    cards.deltaCount = delta(cur.count, prev.count);
  }

  const maxMinor = chartDaysArr.reduce((m, d) => Math.max(m, d.site, d.product), 0);

  const listRows = ((listRes.data ?? []) as unknown as Array<Omit<FinanceListRow, 'payment_method'> & { payment_method?: string | null }>).map(
    (r) => ({ ...r, payment_method: r.payment_method ?? null }),
  );

  return {
    ...base,
    tableMissing: false,
    lastSyncedAt: (lastRes.data?.[0]?.synced_at as string | undefined) ?? null,
    rows: listRows,
    total: listRes.count ?? 0,
    cards,
    extra,
    chart: { currency: primary, days: chartDaysArr, maxMinor },
  };
}

async function loadFinanceDashboardUncached(admin: SupabaseClient, f: FinanceFilters): Promise<FinanceDashboardData> {
  const first = await loadOnce(admin, f, true);
  if ('retryWithoutMethod' in first) {
    const second = await loadOnce(admin, f, false);
    if ('retryWithoutMethod' in second) throw new Error('bepaid_transactions: unexpected schema');
    return second;
  }
  return first;
}

const loadFinanceDashboardCached = unstable_cache(
  async (key: string) => loadFinanceDashboardUncached(createAdminClient(), JSON.parse(key) as FinanceFilters),
  ['admin-finance-dashboard'],
  { revalidate: 20, tags: ['admin-finance'] },
);

export async function loadFinanceDashboard(_admin: SupabaseClient, f: FinanceFilters): Promise<FinanceDashboardData> {
  return loadFinanceDashboardCached(JSON.stringify(f));
}

export function formatMinor(amountMinor: number, currency: string): string {
  return `${(Number(amountMinor) / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function formatTotals(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return formatMinor(0, 'BYN');
  return totals.map((t) => formatMinor(t.amountMinor, t.currency)).join(' · ');
}

export function journalStatusLabel(status: JournalStatus, kind: 'payment' | 'refund'): string {
  if (status === 'paid') return 'Оплачен';
  if (status === 'refunded') return 'Возврат';
  if (status === 'pending') return kind === 'refund' ? 'Возврат ожидает' : 'Ожидает';
  if (status === 'failed') return kind === 'refund' ? 'Возврат не прошёл' : 'Не прошёл';
  return 'Отменён / истёк';
}

export function journalSourceLabel(source: JournalSource): string {
  return source === 'site' ? 'Курс' : 'Оплата занятий';
}

export function paymentMethodLabel(method: string | null): string {
  if (method === 'card') return 'Карта';
  if (method === 'erip') return 'ЕРИП';
  if (method === 'other') return 'Другое';
  return '—';
}
