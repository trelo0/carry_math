import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAccessProduct } from '@/lib/bot/accesses';
import { fulfillPurchase, PurchaseFulfillError } from '@/lib/bot/purchase-fulfillment';

export const dynamic = 'force-dynamic';

type WebhookBody = {
  telegramId?: number;
  product?: string;
  packageIndex?: number;
  teacherId?: string;
  externalId?: string;
  /** Оплата пробного по lead_payments.external_id */
  trialExternalId?: string;
};

/** Webhook эквайринга: idempotent fulfill после успешной оплаты. */
export async function POST(request: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? process.env.PURCHASE_FULFILL_SECRET;
  const headerSecret = request.headers.get('x-payment-secret') ?? request.headers.get('x-fulfill-secret');
  if (!secret || headerSecret !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: WebhookBody;
  try {
    body = (await request.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const trialExternalId = body.trialExternalId?.trim() || (body.product === 'trial' ? body.externalId?.trim() : '');
  if (trialExternalId) {
    try {
      const admin = createAdminClient();
      const { processTrialPaymentWebhook } = await import('@/lib/bot/client-trial-pay-flow');
      const result = await processTrialPaymentWebhook(admin, trialExternalId);
      return NextResponse.json({ ok: true, trial: true, leadId: result.leadId });
    } catch (error) {
      console.error('[payments/webhook trial]', error);
      try {
        const admin = createAdminClient();
        const { recordTrialPaymentProblem } = await import('@/lib/bot/admin/problems-hooks');
        await recordTrialPaymentProblem(
          admin,
          trialExternalId,
          error instanceof Error ? error.message : 'Internal error',
        );
      } catch (logErr) {
        console.error('[payments/webhook trial problem]', logErr);
      }
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  if (typeof body.telegramId !== 'number' || !body.product || !isAccessProduct(body.product)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (!body.externalId?.trim()) {
    return NextResponse.json({ error: 'externalId required for idempotency' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const result = await fulfillPurchase(admin, body.telegramId, {
      product: body.product,
      packageIndex: body.packageIndex,
      teacherId: body.teacherId,
      externalId: body.externalId.trim(),
    });
    return NextResponse.json({
      ok: true,
      packageId: result.packageId,
      alreadyFulfilled: result.alreadyFulfilled,
    });
  } catch (error) {
    if (error instanceof PurchaseFulfillError) {
      try {
        const admin = createAdminClient();
        const { recordPaymentFulfillProblem } = await import('@/lib/bot/admin/problems-hooks');
        await recordPaymentFulfillProblem(admin, {
          telegramId: body.telegramId,
          externalId: body.externalId?.trim(),
          code: error.code,
          message: error.message,
          critical: false,
        });
      } catch (logErr) {
        console.error('[payments/webhook problem]', logErr);
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[payments/webhook]', error);
    try {
      const admin = createAdminClient();
      const { recordPaymentFulfillProblem } = await import('@/lib/bot/admin/problems-hooks');
      await recordPaymentFulfillProblem(admin, {
        telegramId: body.telegramId,
        externalId: body.externalId?.trim(),
        message: error instanceof Error ? error.message : 'Internal error',
        critical: true,
      });
    } catch (logErr) {
      console.error('[payments/webhook problem]', logErr);
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
