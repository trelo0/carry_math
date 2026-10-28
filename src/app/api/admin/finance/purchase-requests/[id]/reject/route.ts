import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { rejectPurchaseRequest } from '@/lib/bot/purchase-confirm';
import { isPurchaseRequestTableError } from '@/lib/bot/purchase-requests';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const { note, request } = await rejectPurchaseRequest(auth.admin, id, auth.telegramId);
    await logAdminAction(auth.admin, {
      actorTelegramId: auth.telegramId,
      action: 'purchase.reject',
      entityType: 'purchase_request',
      entityId: id,
      targetTelegramId: request.telegram_id,
    });
    revalidatePath('/cabinet/admin/finance');
    return NextResponse.json({ ok: true, note, status: request.status });
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      return NextResponse.json({ error: 'Таблица purchase_requests недоступна' }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : 'Не удалось отклонить заявку';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
