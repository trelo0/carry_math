import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { logAdminAction } from '@/lib/bot/admin/action-log';

/** Админ: отметить занятие оплаченным / снять отметку. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { lessonId } = await params;
  const id = Number(lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  let body: { paid?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (typeof body.paid !== 'boolean') {
    return NextResponse.json({ error: 'paid (boolean) required' }, { status: 400 });
  }

  const { data: lesson, error: loadError } = await auth.admin
    .from('scheduled_lessons')
    .select('id, status, teacher_telegram_id, is_paid')
    .eq('id', id)
    .maybeSingle();
  if (loadError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }
  if (lesson.status === 'cancelled') {
    return NextResponse.json({ error: 'Занятие отменено' }, { status: 409 });
  }

  const { error } = await auth.admin
    .from('scheduled_lessons')
    .update({ is_paid: body.paid, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAdminAction(auth.admin, {
    actorTelegramId: auth.telegramId,
    action: 'lesson.paid',
    entityType: 'scheduled_lesson',
    entityId: id,
    targetTelegramId: (lesson.teacher_telegram_id as number | null) ?? null,
    detail: { paid: body.paid, previous: lesson.is_paid ?? null },
  });

  revalidatePath('/cabinet/staff');
  revalidatePath('/cabinet/admin/schedule');
  return NextResponse.json({ ok: true, paid: body.paid });
}
