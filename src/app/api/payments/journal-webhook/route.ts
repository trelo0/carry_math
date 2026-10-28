import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  listJournalWebhookTargets,
  recordBePaidJournalEntry,
} from '@/lib/bepaid/journal';
import { verifyBePaidBasicAuth, verifyBePaidContentSignature } from '@/lib/bepaid/signature';

export const dynamic = 'force-dynamic';

/**
 * Webhook только для журнала (статические pay_url / confirm_url продуктов bePaid).
 * Укажите URL в личном кабинете bePaid → настройки магазина → уведомления.
 * Подходит и для основного магазина (BEPAY_*), и для отдельного (BEPAID_PRODUCTS_*).
 */
export async function POST(request: Request) {
  const targets = listJournalWebhookTargets();
  if (targets.length === 0) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('content-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const authHeader = request.headers.get('authorization');
  let matched: (typeof targets)[number] | null = null;
  for (const target of targets) {
    if (!verifyBePaidContentSignature(rawBody, signature, target.rsaPublicKey)) continue;
    if (authHeader && !verifyBePaidBasicAuth(authHeader, target.shop.shopId, target.shop.secretKey)) {
      continue;
    }
    matched = target;
    break;
  }
  if (!matched) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { transaction?: Record<string, unknown> };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.transaction) return NextResponse.json({ ok: true, ignored: true });

  try {
    const admin = createAdminClient();
    const forceProduct = matched.shop.key === 'products';
    const result = await recordBePaidJournalEntry(admin, body.transaction, {
      shop: matched.shop,
      forceProduct,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[bePaid journal webhook]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
