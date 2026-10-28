import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Журнал транзакций bePaid. Только регистрация платежей для просмотра:
 * выдачу товара/доступа не затрагивает и с пользователями District не связывает.
 */

export type JournalSource = 'site' | 'product';
export type JournalKind = 'payment' | 'refund';
export type JournalStatus = 'paid' | 'pending' | 'failed' | 'cancelled' | 'refunded';

export type JournalRow = {
  uid: string;
  source: JournalSource;
  kind: JournalKind;
  status: JournalStatus;
  bepaid_status: string | null;
  amount_minor: number;
  currency: string;
  payer_name: string | null;
  product_title: string | null;
  tracking_id: string | null;
  order_id: number | null;
  is_test: boolean;
  /** card | erip | other | null */
  payment_method: 'card' | 'erip' | 'other' | null;
  occurred_at: string;
  paid_at: string | null;
  bepaid_created_at: string | null;
};

type RawTx = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Конфигурация магазинов
// ---------------------------------------------------------------------------

export type JournalShop = {
  key: 'main' | 'products';
  shopId: string;
  secretKey: string;
};

export type JournalShopsConfig = {
  main: JournalShop | null;
  /** Отдельный магазин готовых продуктов (BEPAID_PRODUCTS_*). null — не настроен. */
  products: JournalShop | null;
};

export function getJournalShopsConfig(): JournalShopsConfig {
  const mainId = process.env.BEPAY_SHOP_ID?.trim();
  const mainSecret = process.env.BEPAY_SECRET_KEY?.trim();
  const main = mainId && mainSecret ? { key: 'main' as const, shopId: mainId, secretKey: mainSecret } : null;

  const prodId = process.env.BEPAID_PRODUCTS_SHOP_ID?.trim();
  const prodSecret = process.env.BEPAID_PRODUCTS_SECRET_KEY?.trim();
  const products =
    prodId && prodSecret && prodId !== mainId
      ? { key: 'products' as const, shopId: prodId, secretKey: prodSecret }
      : null;

  return { main, products };
}

function basicAuth(shop: JournalShop): string {
  return `Basic ${Buffer.from(`${shop.shopId}:${shop.secretKey}`).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Маппинг транзакции bePaid → строка журнала
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function mapStatus(kind: JournalKind, raw: string): JournalStatus {
  const s = raw.toLowerCase();
  if (s === 'successful') return kind === 'refund' ? 'refunded' : 'paid';
  if (s === 'failed' || s === 'error' || s === 'declined') return 'failed';
  if (s === 'expired' || s === 'canceled' || s === 'cancelled') return 'cancelled';
  return 'pending'; // pending, incomplete и прочее незавершённое
}

function payerName(tx: RawTx): string | null {
  const billing = (tx.billing_address ?? null) as Record<string, unknown> | null;
  const first = str(billing?.first_name);
  const last = str(billing?.last_name);
  const full = [first, last].filter(Boolean).join(' ');
  if (full) return full;
  const customer = (tx.customer ?? null) as Record<string, unknown> | null;
  const cFirst = str(customer?.first_name);
  const cLast = str(customer?.last_name);
  const cFull = [cFirst, cLast].filter(Boolean).join(' ');
  if (cFull) return cFull;
  const holder = str((tx.credit_card as Record<string, unknown> | undefined)?.holder);
  return holder;
}

/** Ручные подписи продуктов (JSON): ключ — id/description, значение — название для журнала. */
function loadEnvProductTitleMap(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.BEPAID_PRODUCT_TITLES?.trim();
  if (!raw) return map;
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.trim().toLowerCase();
      const title = v?.trim();
      if (key && title) map.set(key, title);
    }
  } catch {
    // ignore invalid JSON
  }
  return map;
}

function resolveProductTitle(tx: RawTx, productNames?: Map<string, string>): string | null {
  const description = str(tx.description);
  if (!productNames || productNames.size === 0) return description;

  const keys: string[] = [];
  if (description) keys.push(description.toLowerCase());

  const additional = tx.additional_data;
  if (additional && typeof additional === 'object') {
    for (const field of ['product_id', 'product', 'pay_product_id', 'vendor'] as const) {
      const v = str((additional as Record<string, unknown>)[field]);
      if (v) keys.push(v.toLowerCase());
    }
  }

  const order = tx.order;
  if (order && typeof order === 'object') {
    const od = str((order as Record<string, unknown>).description);
    if (od) keys.push(od.toLowerCase());
  }

  for (const key of keys) {
    const hit = productNames.get(key);
    if (hit) return hit;
  }
  return description;
}

function paymentMethodOf(tx: RawTx): JournalRow['payment_method'] {
  const type = (str(tx.payment_method_type) ?? '').toLowerCase();
  if (type === 'credit_card' || type === 'card') return 'card';
  if (type === 'erip') return 'erip';
  if (type) return 'other';
  if (tx.credit_card && typeof tx.credit_card === 'object') return 'card';
  if (tx.erip && typeof tx.erip === 'object') return 'erip';
  return null;
}

/** Возвращает null для типов, которые журнал не отслеживает (authorization, capture, payout…). */
export function mapBePaidTransaction(
  tx: RawTx,
  source: JournalSource,
  productNames?: Map<string, string>,
): JournalRow | null {
  const uid = str(tx.uid);
  if (!uid) return null;

  const type = (str(tx.type) ?? 'payment').toLowerCase();
  if (type !== 'payment' && type !== 'refund') return null;
  const kind: JournalKind = type === 'refund' ? 'refund' : 'payment';

  const amount = Number(tx.amount);
  if (!Number.isFinite(amount)) return null;

  const createdAt = iso(tx.created_at);
  const paidAt = iso(tx.paid_at);
  const occurred = paidAt ?? createdAt ?? new Date().toISOString();

  const rawStatus = str(tx.status) ?? 'pending';
  const title = resolveProductTitle(tx, productNames);

  const orderId = Number(tx.order_id);

  return {
    uid,
    source,
    kind,
    status: mapStatus(kind, rawStatus),
    bepaid_status: rawStatus,
    amount_minor: Math.round(amount),
    currency: (str(tx.currency) ?? 'BYN').toUpperCase(),
    payer_name: payerName(tx),
    product_title: title,
    tracking_id: str(tx.tracking_id),
    order_id: Number.isFinite(orderId) ? orderId : null,
    is_test: tx.test === true,
    payment_method: paymentMethodOf(tx),
    occurred_at: occurred,
    paid_at: paidAt,
    bepaid_created_at: createdAt,
  };
}

// ---------------------------------------------------------------------------
// Сохранение
// ---------------------------------------------------------------------------

async function loadSiteTrackingIds(admin: SupabaseClient, trackingIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(trackingIds.filter((id) => UUID_RE.test(id)))];
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from('purchase_requests')
      .select('id')
      .in('id', ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of data ?? []) found.add(String((row as { id: string }).id));
  }
  return found;
}

/** Каталог статических продуктов bePaid (pay_url) + BEPAID_PRODUCT_TITLES из env. */
export async function fetchProductNameMap(shop: JournalShop): Promise<Map<string, string>> {
  const map = loadEnvProductTitleMap();
  try {
    const res = await fetch('https://api.bepaid.by/products', {
      headers: { Accept: 'application/json', Authorization: basicAuth(shop) },
      cache: 'no-store',
    });
    if (!res.ok) return map;
    const list = (await res.json()) as Array<{
      id?: string;
      name?: string;
      description?: string;
      amount?: number | string;
      currency?: string;
    }>;
    if (!Array.isArray(list)) return map;
    for (const p of list) {
      const name = str(p.name);
      if (!name) continue;
      map.set(name.toLowerCase(), name);
      const id = str(p.id);
      if (id) map.set(id.toLowerCase(), name);
      const d = str(p.description);
      if (d) map.set(d.toLowerCase(), name);
      const amount = Number(p.amount);
      if (id && Number.isFinite(amount)) {
        map.set(`${id}:${amount}`.toLowerCase(), name);
        if (p.currency) map.set(`${id}:${amount}:${String(p.currency).toLowerCase()}`.toLowerCase(), name);
      }
    }
  } catch {
    // каталог — необязательное уточнение
  }
  return map;
}

export type JournalWebhookTarget = {
  shop: JournalShop;
  rsaPublicKey: string;
};

/** Магазины, с которых может прийти webhook (основной checkout и/или продукты). */
export function listJournalWebhookTargets(): JournalWebhookTarget[] {
  const config = getJournalShopsConfig();
  const mainKey = process.env.BEPAY_RSA_PUBLIC_KEY?.trim();
  const productsKey = process.env.BEPAID_PRODUCTS_RSA_PUBLIC_KEY?.trim();
  const out: JournalWebhookTarget[] = [];

  if (config.main && mainKey) {
    out.push({ shop: config.main, rsaPublicKey: mainKey });
  }
  if (config.products) {
    const key =
      productsKey ??
      (config.main && config.products.shopId === config.main.shopId ? mainKey : undefined);
    if (key && !out.some((t) => t.shop.shopId === config.products!.shopId)) {
      out.push({ shop: config.products, rsaPublicKey: key });
    }
  }
  return out;
}

export type IngestResult = { saved: number; skipped: number };

/** Запись в журнал из webhook (статические ссылки и checkout). */
export async function recordBePaidJournalEntry(
  admin: SupabaseClient,
  transaction: Record<string, unknown>,
  opts: { shop?: JournalShop | null; forceProduct?: boolean } = {},
): Promise<IngestResult> {
  const config = getJournalShopsConfig();
  const shop = opts.shop ?? config.main ?? config.products;
  const productNames = shop ? await fetchProductNameMap(shop) : loadEnvProductTitleMap();
  const forceProduct = opts.forceProduct ?? opts.shop?.key === 'products';
  return ingestBePaidTransactions(admin, [transaction], { forceProduct, productNames });
}

/**
 * Сохраняет транзакции (идемпотентно по uid).
 * forceProduct — транзакции магазина готовых продуктов: источник всегда «product».
 * Иначе источник «site» определяется по совпадению tracking_id с purchase_requests.
 */
export async function ingestBePaidTransactions(
  admin: SupabaseClient,
  raws: RawTx[],
  opts: { forceProduct?: boolean; productNames?: Map<string, string> } = {},
): Promise<IngestResult> {
  if (raws.length === 0) return { saved: 0, skipped: 0 };

  const siteIds = opts.forceProduct
    ? new Set<string>()
    : await loadSiteTrackingIds(
        admin,
        raws.map((r) => str(r.tracking_id)).filter((v): v is string => Boolean(v)),
      );

  const rows: JournalRow[] = [];
  let skipped = 0;
  for (const raw of raws) {
    const tracking = str(raw.tracking_id);
    const source: JournalSource = !opts.forceProduct && tracking && siteIds.has(tracking) ? 'site' : 'product';
    const row = mapBePaidTransaction(raw, source, opts.productNames);
    if (row) rows.push(row);
    else skipped += 1;
  }

  for (let i = 0; i < rows.length; i += 200) {
    const syncedAt = new Date().toISOString();
    const chunk = rows.slice(i, i + 200);
    let { error } = await admin
      .from('bepaid_transactions')
      .upsert(chunk.map((r) => ({ ...r, synced_at: syncedAt })), { onConflict: 'uid' });
    if (error && error.message.includes('payment_method')) {
      // Миграция с колонкой payment_method ещё не применена — сохраняем без неё.
      ({ error } = await admin
        .from('bepaid_transactions')
        .upsert(
          chunk.map(({ payment_method: _pm, ...r }) => ({ ...r, synced_at: syncedAt })),
          { onConflict: 'uid' },
        ));
    }
    if (error) throw error;
  }
  return { saved: rows.length, skipped };
}

// ---------------------------------------------------------------------------
// Исторические транзакции: Reports API v3
// https://docs.bepaid.by/en/payment_management/reports/paginated_report/
// ---------------------------------------------------------------------------

const REPORT_URL = 'https://merchant.bepaid.by/api/reports';
const PAYMENT_METHOD_TYPES = ['credit_card', 'erip', 'alternative'] as const;
const WINDOW_DAYS = 31;
const MAX_PAGES_PER_WINDOW = 40;

function reportDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

type ReportResponse = {
  transactions?: RawTx[];
  has_more?: boolean;
  last_object_id?: string | number | null;
};

async function fetchReportPage(
  shop: JournalShop,
  params: { from: Date; to: Date; method: string; startingAfter?: string },
): Promise<ReportResponse> {
  const res = await fetch(REPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Version': '3',
      Authorization: basicAuth(shop),
    },
    cache: 'no-store',
    body: JSON.stringify({
      report_params: {
        date_type: 'created_at',
        from: reportDate(params.from),
        to: reportDate(params.to),
        status: 'all',
        payment_method_type: params.method,
        time_zone: 'UTC',
        ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
      },
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`bePaid reports ${res.status}: ${text}`);
  }
  return (await res.json()) as ReportResponse;
}

export type ShopSyncSummary = {
  shop: 'main' | 'products';
  fetched: number;
  saved: number;
  skipped: number;
  errors: string[];
};

export type JournalSyncSummary = {
  days: number;
  shops: ShopSyncSummary[];
  /** Отдельный магазин готовых продуктов не настроен. */
  productsShopConfigured: boolean;
};

async function syncShop(
  admin: SupabaseClient,
  shop: JournalShop,
  forceProduct: boolean,
  days: number,
): Promise<ShopSyncSummary> {
  const summary: ShopSyncSummary = { shop: shop.key, fetched: 0, saved: 0, skipped: 0, errors: [] };
  const productNames = await fetchProductNameMap(shop);

  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  let okCalls = 0;

  for (let winStart = start.getTime(); winStart < end.getTime(); winStart += WINDOW_DAYS * 86_400_000) {
    const from = new Date(winStart);
    const to = new Date(Math.min(winStart + WINDOW_DAYS * 86_400_000 - 1000, end.getTime()));

    for (const method of PAYMENT_METHOD_TYPES) {
      try {
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES_PER_WINDOW; page += 1) {
          const data = await fetchReportPage(shop, { from, to, method, startingAfter: cursor });
          okCalls += 1;
          const txs = Array.isArray(data.transactions) ? data.transactions : [];
          summary.fetched += txs.length;
          const res = await ingestBePaidTransactions(admin, txs, { forceProduct, productNames });
          summary.saved += res.saved;
          summary.skipped += res.skipped;
          if (!data.has_more || data.last_object_id == null) break;
          cursor = String(data.last_object_id);
        }
      } catch (error) {
        summary.errors.push(`${method}: ${error instanceof Error ? error.message : 'ошибка'}`);
      }
    }
  }

  // Ошибки отдельных способов оплаты (не подключён у магазина) не критичны, если хоть один запрос прошёл.
  if (okCalls > 0) summary.errors = [];
  return summary;
}

/**
 * Синхронизация истории. Повторный запуск безопасен (upsert по uid).
 * Основной магазин: tracking_id из purchase_requests → «site», остальное → «product».
 * Отдельный магазин продуктов (BEPAID_PRODUCTS_*): все транзакции → «product».
 */
export async function syncBePaidJournal(admin: SupabaseClient, days: number): Promise<JournalSyncSummary> {
  const config = getJournalShopsConfig();
  const shops: ShopSyncSummary[] = [];
  const safeDays = Math.min(Math.max(Math.trunc(days) || 7, 1), 365);

  if (config.main) shops.push(await syncShop(admin, config.main, false, safeDays));
  if (config.products) shops.push(await syncShop(admin, config.products, true, safeDays));

  return { days: safeDays, shops, productsShopConfigured: Boolean(config.products) };
}
