import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCourseFulfillContext, runCourseSideEffectsAfterFulfill } from '@/lib/bepaid/fulfill-from-request';
import { getPurchaseRequest, type PurchaseRequestRow } from '@/lib/bot/purchase-requests';
import { resolvePurchaseOffer } from '@/lib/bot/purchase-fulfillment';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { telegramSend } from '@/lib/telegram';
import { resolveMemberChatId } from '@/lib/bot/staff/messaging';
import { logLeadEvent } from '@/lib/bot/admin/lead-events';

export type WebhookFulfillResult =
  | { ok: true; alreadyProcessed?: boolean; packageId?: number | null; mode: 'course' | 'paid_only' }
  | { ok: false; status: number; body: Record<string, unknown> };

async function notifyStudentOrderPaid(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
): Promise<void> {
  const chatId = await resolveMemberChatId(admin, request.telegram_id);
  if (!chatId) return;
  const lines = ['✅ Оплата получена', '', request.title, ''];
  if (request.order_kind === 'trial') {
    lines.push('Администратор запишет вас на пробное занятие.');
  } else if (request.product === 'individual' || request.product === 'group') {
    lines.push('Занятия будут начислены администратором после проверки оплаты.');
  }
  await telegramSend('sendMessage', { chat_id: chatId, text: lines.join('\n') });
}

export async function fulfillPurchaseRequestFromWebhook(
  admin: SupabaseClient,
  trackingId: string,
  lockVersion: number,
  bepaidUid: string | undefined,
): Promise<WebhookFulfillResult> {
  const purchaseRequest = await getPurchaseRequest(admin, trackingId);
  if (!purchaseRequest) {
    return { ok: false, status: 404, body: { error: 'Purchase request not found' } };
  }

  const isCourse = purchaseRequest.product === 'course';
  const paidOnly =
    !isCourse &&
    (purchaseRequest.order_kind === 'trial' ||
      purchaseRequest.product === 'individual' ||
      purchaseRequest.product === 'group');

  if (paidOnly) {
    const { data, error } = await admin.rpc('mark_purchase_request_paid', {
      p_id: trackingId,
      p_expected_version: lockVersion,
      p_telegram_id: purchaseRequest.telegram_id,
      p_product: purchaseRequest.product,
      p_amount_byn: purchaseRequest.amount_byn,
      p_bepaid_transaction_uid: bepaidUid ?? null,
    });
    if (error) throw error;
    const atomicResult = data as { success: boolean; reason?: string };
    if (!atomicResult.success) {
      if (atomicResult.reason === 'already_paid') {
        return { ok: true, alreadyProcessed: true, mode: 'paid_only' };
      }
      if (atomicResult.reason === 'stale_version') {
        return { ok: true, alreadyProcessed: true, mode: 'paid_only' };
      }
      return { ok: false, status: 500, body: { error: atomicResult.reason } };
    }
    const fresh = (await getPurchaseRequest(admin, trackingId)) ?? purchaseRequest;
    await notifyStudentOrderPaid(admin, fresh);
    if (fresh.lead_id) {
      await logLeadEvent(admin, {
        leadId: fresh.lead_id,
        eventType: fresh.order_kind === 'trial' ? 'trial_paid' : 'enrollment_purchase_request',
        detail: { request_id: fresh.id, paid: true },
      });
    }
    return { ok: true, mode: 'paid_only' };
  }

  const pricing = await getCabinetPricing();
  const offer = await resolvePurchaseOffer(pricing, {
    product: purchaseRequest.product as 'course',
    packageIndex: purchaseRequest.package_index,
    teacherId: purchaseRequest.teacher_id || undefined,
    courseSlug: purchaseRequest.course_slug || undefined,
  });

  const fulfillLessons =
    purchaseRequest.lessons_count != null && purchaseRequest.lessons_count > 0
      ? purchaseRequest.lessons_count
      : offer.lessons;

  if (offer.amountByn !== purchaseRequest.amount_byn) {
    return { ok: false, status: 409, body: { error: 'Price configuration mismatch' } };
  }

  const scenario = purchaseRequest.scenario || undefined;
  const fulfillCourseContext = await resolveCourseFulfillContext(admin, purchaseRequest, scenario);
  if (purchaseRequest.product === 'course' && !fulfillCourseContext.courseId) {
    return { ok: false, status: 409, body: { error: 'Course not resolved for payment' } };
  }

  const { data, error } = await admin.rpc('fulfill_purchase_full', {
    p_id: trackingId,
    p_expected_version: lockVersion,
    p_telegram_id: purchaseRequest.telegram_id,
    p_product: purchaseRequest.product,
    p_amount_byn: purchaseRequest.amount_byn,
    p_lessons: fulfillLessons,
    p_title: purchaseRequest.title,
    p_expires_at: null,
    p_course_id: fulfillCourseContext.courseId,
    p_scenario: scenario || null,
    p_start_module_id: fulfillCourseContext.startModuleId,
    p_start_lesson_id: fulfillCourseContext.startLessonId,
    p_bepaid_transaction_uid: bepaidUid ?? null,
  });
  if (error) throw error;
  const atomicResult = data as { success: boolean; reason?: string; package_id?: number };
  if (!atomicResult.success) {
    if (atomicResult.reason === 'already_approved') {
      return { ok: true, alreadyProcessed: true, packageId: atomicResult.package_id, mode: 'course' };
    }
    if (atomicResult.reason === 'stale_version') {
      return { ok: true, alreadyProcessed: true, mode: 'course' };
    }
    return { ok: false, status: 500, body: { error: atomicResult.reason } };
  }

  if (atomicResult.package_id && purchaseRequest.product === 'course' && fulfillCourseContext) {
    await runCourseSideEffectsAfterFulfill(
      admin,
      purchaseRequest,
      atomicResult.package_id,
      fulfillLessons,
      fulfillCourseContext,
    );
  }

  return { ok: true, packageId: atomicResult.package_id, mode: 'course' };
}
