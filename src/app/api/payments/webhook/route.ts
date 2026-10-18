import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAccessProduct } from '@/lib/bot/accesses';
import { fulfillPurchase, PurchaseFulfillError, resolvePurchaseOffer } from '@/lib/bot/purchase-fulfillment';
import { getPurchaseRequest, markPurchaseRequestResolved } from '@/lib/bot/purchase-requests';
import {
  resolveCourseFulfillContext,
  runCourseSideEffectsAfterFulfill,
} from '@/lib/bepaid/fulfill-from-request';
import { acquireProcessingLockWithRetry, type ProcessingLockResult } from '@/lib/bepaid/processing-lock';
import { fetchBePaidTransactionByUid, getBePaidCredentialsFromEnv } from '@/lib/bepaid/transactions';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { createVerify } from 'crypto';

export const dynamic = 'force-dynamic';

function bePaidLockToResponse(lockResult: ProcessingLockResult): NextResponse | null {
  if (lockResult.success) return null;
  if (lockResult.reason === 'finalized') {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }
  if (lockResult.reason === 'already_processing') {
    return NextResponse.json({ ok: true, status: 'retry_later' });
  }
  if (lockResult.reason === 'not_pending') {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }
  return NextResponse.json(
    { error: 'Cannot acquire lock', reason: lockResult.reason },
    { status: lockResult.reason === 'reset_to_pending' ? 503 : 409 },
  );
}

async function verifyBePaidRecoveryTransaction(
  uid: string,
  trackingId: string,
  expectedAmount: number,
): Promise<boolean> {
  const creds = getBePaidCredentialsFromEnv();
  if (!creds) return true;
  try {
    const remote = await fetchBePaidTransactionByUid(uid, creds);
    if (!remote || remote.status !== 'successful') return false;
    if (remote.trackingId && remote.trackingId !== trackingId) return false;
    if (remote.amount !== expectedAmount || remote.currency !== 'BYN') return false;
    return true;
  } catch (error) {
    console.error('[bePaid webhook] Recovery verification failed:', error);
    return false;
  }
}

type LegacyWebhookBody = {
  telegramId?: number;
  product?: string;
  packageIndex?: number;
  teacherId?: string;
  courseSlug?: string;
  scenario?: 'start_from_beginning' | 'join_current';
  externalId?: string;
  /** Оплата пробного по lead_payments.external_id */
  trialExternalId?: string;
};

type BePaidWebhookBody = {
  transaction?: {
    uid?: string;
    status?: string;
    amount?: number;
    currency?: string;
    tracking_id?: string;
    custom_fields?: {
      custom_field_1?: { value?: string };
      custom_field_2?: { value?: string };
    };
  };
};

/**
 * Проверяет RSA-SHA256 подпись bePaid webhook.
 */
function verifyBePaidSignature(rawBody: string, signature: string, publicKeyPem: string): boolean {
  try {
    const publicKeyPemFormatted = publicKeyPem
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '\n')
      .trim();
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyPemFormatted}\n-----END PUBLIC KEY-----`;

    const verify = createVerify('SHA256');
    verify.update(rawBody, 'utf8');
    verify.end();

    const signatureBuffer = Buffer.from(signature, 'base64');
    return verify.verify(publicKey, signatureBuffer);
  } catch (error) {
    console.error('[bePaid signature verification]', error);
    return false;
  }
}

/** Webhook эквайринга: idempotent fulfill после успешной оплаты. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: LegacyWebhookBody | BePaidWebhookBody;

  // Проверка на bePaid webhook (содержит transaction)
  try {
    body = JSON.parse(rawBody) as LegacyWebhookBody | BePaidWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // bePaid webhook: проверка подписи
  if ('transaction' in body && body.transaction) {
    const signature = request.headers.get('content-signature');
    const rsaPublicKey = process.env.BEPAY_RSA_PUBLIC_KEY;

    if (!signature || !rsaPublicKey) {
      console.error('[bePaid webhook] Missing signature or public key');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!verifyBePaidSignature(rawBody, signature, rsaPublicKey)) {
      console.error('[bePaid webhook] Invalid signature');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const transaction = body.transaction;
    const { uid, status, amount, currency, tracking_id, custom_fields } = transaction;

    if (!tracking_id) {
      console.error('[bePaid webhook] Missing tracking_id');
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (status !== 'successful') {
      console.log('[bePaid webhook] Transaction not successful:', status);
      return NextResponse.json({ ok: true, status: 'ignored' });
    }

    const admin = createAdminClient();

    // Поиск заявки по tracking_id
    const purchaseRequest = await getPurchaseRequest(admin, tracking_id);
    if (!purchaseRequest) {
      console.error('[bePaid webhook] Purchase request not found:', tracking_id);
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    // Проверка суммы и валюты
    const expectedAmount = Math.round(purchaseRequest.amount_byn * 100);
    if (amount !== expectedAmount || currency !== 'BYN') {
      console.error('[bePaid webhook] Amount/currency mismatch', {
        expected: { amount: expectedAmount, currency: 'BYN' },
        received: { amount, currency },
      });
      // Отклоняем без захвата lock — не было оплаты
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    }

    let lockResult: ProcessingLockResult;
    try {
      lockResult = await acquireProcessingLockWithRetry(admin, tracking_id);
    } catch (error) {
      console.error('[bePaid webhook] Failed to acquire lock:', error);
      return NextResponse.json(
        { error: 'RPC not available, deployment required', code: 'DEPLOYMENT_REQUIRED' },
        { status: 503 },
      );
    }

    const lockBlocked = bePaidLockToResponse(lockResult);
    if (lockBlocked) return lockBlocked;

    const scenario = purchaseRequest.scenario || undefined;
    const telegramId = purchaseRequest.telegram_id;

    if (lockResult.mode === 'recovery' && uid) {
      const ok = await verifyBePaidRecoveryTransaction(uid, tracking_id, expectedAmount);
      if (!ok) {
        return NextResponse.json({ ok: true, status: 'retry_later' });
      }
    }

    try {
      let atomicResult;
      let fulfillLessons = 1;
      let fulfillCourseContext: Awaited<ReturnType<typeof resolveCourseFulfillContext>> | null = null;

      try {
        const pricing = await getCabinetPricing();
        const offer = await resolvePurchaseOffer(pricing, {
          product: purchaseRequest.product,
          packageIndex: purchaseRequest.package_index,
          teacherId: purchaseRequest.teacher_id || undefined,
          courseSlug: purchaseRequest.course_slug || undefined,
        });

        fulfillLessons =
          purchaseRequest.lessons_count != null && purchaseRequest.lessons_count > 0
            ? purchaseRequest.lessons_count
            : offer.lessons;

        if (offer.amountByn !== purchaseRequest.amount_byn) {
          console.error('[bePaid webhook] Offer amount drift vs request', {
            requestAmount: purchaseRequest.amount_byn,
            offerAmount: offer.amountByn,
          });
          return NextResponse.json({ error: 'Price configuration mismatch' }, { status: 409 });
        }

        fulfillCourseContext = await resolveCourseFulfillContext(admin, purchaseRequest, scenario);

        if (purchaseRequest.product === 'course' && !fulfillCourseContext.courseId) {
          console.error('[bePaid webhook] Course purchase without resolvable course_id', {
            requestId: purchaseRequest.id,
            courseSlug: purchaseRequest.course_slug,
          });
          return NextResponse.json({ error: 'Course not resolved for payment' }, { status: 409 });
        }

        const { data, error } = await admin.rpc('fulfill_purchase_full', {
          p_id: tracking_id,
          p_expected_version: lockResult.version,
          p_telegram_id: telegramId,
          p_product: purchaseRequest.product,
          p_amount_byn: purchaseRequest.amount_byn,
          p_lessons: fulfillLessons,
          p_title: purchaseRequest.title,
          p_expires_at: null,
          p_course_id: fulfillCourseContext.courseId,
          p_scenario: scenario || null,
          p_start_module_id: fulfillCourseContext.startModuleId,
          p_start_lesson_id: fulfillCourseContext.startLessonId,
          p_bepaid_transaction_uid: uid ?? null,
        });
        if (error) throw error;
        atomicResult = data as { success: boolean; reason?: string; payment_id?: number; package_id?: number };
      } catch (error) {
        console.error('[bePaid webhook] Atomic fulfill failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Различаем типы ошибок
        if (errorMessage.includes('different') || errorMessage.includes('conflict')) {
          // Ошибка верификации данных — диагностическая ошибка
          return NextResponse.json(
            { error: 'Data verification failed', details: errorMessage },
            { status: 409 }
          );
        }
        
        // Временная ошибка БД — можно повторить
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
      }

      if (!atomicResult.success) {
        if (atomicResult.reason === 'already_approved') {
          console.log('[bePaid webhook] Already approved');
          return NextResponse.json({ ok: true, alreadyProcessed: true });
        }
        if (atomicResult.reason === 'stale_version') {
          console.log('[bePaid webhook] Stale version, another handler owns the lock');
          return NextResponse.json({ ok: true, status: 'retry_later' });
        }
        return NextResponse.json({ error: 'Unknown error', reason: atomicResult.reason }, { status: 500 });
      }

      if (atomicResult.package_id && purchaseRequest.product === 'course' && fulfillCourseContext) {
        try {
          await runCourseSideEffectsAfterFulfill(
            admin,
            purchaseRequest,
            atomicResult.package_id,
            fulfillLessons,
            fulfillCourseContext,
          );
        } catch (sideEffectError) {
          console.error('[bePaid webhook] Course side effects failed:', sideEffectError);
          return NextResponse.json({ error: 'Post-fulfill error' }, { status: 500 });
        }
      }

      return NextResponse.json({
        ok: true,
        packageId: atomicResult.package_id,
      });
    } catch (error) {
      console.error('[bePaid webhook fulfill]', error);
      
      // Различаем типы ошибок
      if (error instanceof PurchaseFulfillError) {
        // Ошибка бизнес-логики — помечаем rejected через markPurchaseRequestResolved
        await markPurchaseRequestResolved(admin, tracking_id, 'rejected');
        return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
      }
      
      // Временная ошибка — не помечаем rejected, можно повторить
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  // Legacy webhook (прямой вызов с секретом)
  const legacyBody = body as LegacyWebhookBody;
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? process.env.PURCHASE_FULFILL_SECRET;
  const headerSecret = request.headers.get('x-payment-secret') ?? request.headers.get('x-fulfill-secret');
  if (!secret || headerSecret !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const trialExternalId = legacyBody.trialExternalId?.trim() || (legacyBody.product === 'trial' ? legacyBody.externalId?.trim() : '');
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

  if (typeof legacyBody.telegramId !== 'number' || !legacyBody.product || !isAccessProduct(legacyBody.product)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (!legacyBody.externalId?.trim()) {
    return NextResponse.json({ error: 'externalId required for idempotency' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const result = await fulfillPurchase(admin, legacyBody.telegramId, {
      product: legacyBody.product,
      packageIndex: legacyBody.packageIndex,
      teacherId: legacyBody.teacherId,
      courseSlug: legacyBody.courseSlug,
      scenario: legacyBody.scenario,
      externalId: legacyBody.externalId.trim(),
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
          telegramId: legacyBody.telegramId,
          externalId: legacyBody.externalId?.trim(),
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
        telegramId: legacyBody.telegramId,
        externalId: legacyBody.externalId?.trim(),
        message: error instanceof Error ? error.message : 'Internal error',
        critical: true,
      });
    } catch (logErr) {
      console.error('[payments/webhook problem]', logErr);
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
