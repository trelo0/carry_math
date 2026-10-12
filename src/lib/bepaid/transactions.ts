export type BePaidTransactionQuery = {
  uid: string;
  status: string;
  amount: number;
  currency: string;
  trackingId: string | null;
};

type BePaidCredentials = {
  shopId: string;
  secretKey: string;
};

function bePaidAuthHeader(creds: BePaidCredentials): string {
  return Buffer.from(`${creds.shopId}:${creds.secretKey}`).toString('base64');
}

function parseTransactionPayload(data: unknown): BePaidTransactionQuery | null {
  const tx = (data as { transaction?: Record<string, unknown> })?.transaction;
  if (!tx || typeof tx.uid !== 'string') return null;
  return {
    uid: tx.uid,
    status: String(tx.status ?? ''),
    amount: Number(tx.amount),
    currency: String(tx.currency ?? ''),
    trackingId: typeof tx.tracking_id === 'string' ? tx.tracking_id : null,
  };
}

/** Статус транзакции checkout (карты): https://docs.bepaid.by/en/integration/card_api/transactions/status_query/ */
export async function fetchBePaidTransactionByUid(
  uid: string,
  creds: BePaidCredentials,
): Promise<BePaidTransactionQuery | null> {
  const url = `https://gateway.bepaid.by/transactions/${encodeURIComponent(uid)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${bePaidAuthHeader(creds)}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bePaid transaction query failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return parseTransactionPayload(data);
}

/** Альтернативный endpoint по tracking_id. */
export async function fetchBePaidTransactionByTrackingId(
  trackingId: string,
  creds: BePaidCredentials,
): Promise<BePaidTransactionQuery | null> {
  const url = `https://api.bepaid.by/beyag/transactions/tracking_id/${encodeURIComponent(trackingId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${bePaidAuthHeader(creds)}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bePaid tracking query failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  const wrapped = (data as { transaction?: unknown })?.transaction;
  if (wrapped) return parseTransactionPayload(data);
  const first = (data as { transactions?: Record<string, unknown>[] })?.transactions?.[0];
  if (first) return parseTransactionPayload({ transaction: first });
  return null;
}

export function getBePaidCredentialsFromEnv(): BePaidCredentials | null {
  const shopId = process.env.BEPAY_SHOP_ID;
  const secretKey = process.env.BEPAY_SECRET_KEY;
  if (!shopId || !secretKey) return null;
  return { shopId, secretKey };
}
