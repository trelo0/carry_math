import type { SupabaseClient } from '@supabase/supabase-js';
import { getPurchaseRequest, type PurchaseRequestRow } from './purchase-requests';

export type GrantLessonsResult = {
  granted: number;
  packageId: number | null;
  request: PurchaseRequestRow;
};

export async function grantLessonsFromPurchaseRequest(
  admin: SupabaseClient,
  requestId: string,
  lessons: number,
  adminTelegramId?: number,
  comment?: string | null,
): Promise<GrantLessonsResult> {
  const { data, error } = await admin.rpc('grant_purchase_request_lessons', {
    p_request_id: requestId,
    p_lessons: lessons,
    p_admin_telegram_id: adminTelegramId ?? null,
    p_comment: comment?.trim() || null,
  });
  if (error) throw error;
  const result = data as { success: boolean; reason?: string; granted?: number; package_id?: number };
  if (!result.success) {
    throw new Error(result.reason ?? 'grant_failed');
  }
  const request = await getPurchaseRequest(admin, requestId);
  if (!request) throw new Error('request_not_found');
  return {
    granted: result.granted ?? lessons,
    packageId: result.package_id ?? null,
    request,
  };
}

export function lessonsRemainingToDeliver(request: PurchaseRequestRow): number {
  const total = request.lessons_count ?? 0;
  const delivered = request.lessons_delivered ?? 0;
  return Math.max(0, total - delivered);
}

export function isPaidLessonPackageOrder(request: PurchaseRequestRow): boolean {
  const kind = request.order_kind ?? 'package';
  return (
    kind === 'package' &&
    (request.product === 'individual' || request.product === 'group') &&
    (request.status === 'paid' || request.status === 'approved')
  );
}
