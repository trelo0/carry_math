import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { assertScheduleTeacherTarget, parseTeacherTelegramId } from '@/lib/admin/schedule-target';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { cancelScheduledLesson } from '@/lib/bot/lessons';
import { notifyStudentLessonCancelled } from '@/lib/teacher/notifications';

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

  let body: { teacherTelegramId?: number; reason?: string; reasonNote?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const teacherTelegramId = parseTeacherTelegramId(new URL(request.url), body);
  if (teacherTelegramId == null) {
    return NextResponse.json({ error: 'teacherTelegramId required' }, { status: 400 });
  }

  const target = await assertScheduleTeacherTarget(auth.admin, teacherTelegramId);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  const cancelReason = body.reasonNote?.trim() || body.reason?.trim() || null;

  const { data: lesson, error: loadError } = await auth.admin
    .from('scheduled_lessons')
    .select('id, telegram_id, teacher_telegram_id, kind, topic, starts_at, status')
    .eq('id', id)
    .maybeSingle();
  if (loadError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }
  if (lesson.teacher_telegram_id !== teacherTelegramId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (lesson.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Отменить можно только запланированное занятие' },
      { status: 409 },
    );
  }

  const cancelled = await cancelScheduledLesson(auth.admin, id);
  if (!cancelled) {
    return NextResponse.json(
      { error: 'Занятие уже отменено или проведено — обновите календарь' },
      { status: 409 },
    );
  }
  if (cancelReason) {
    await auth.admin
      .from('scheduled_lessons')
      .update({ cancel_reason: cancelReason, updated_at: new Date().toISOString() })
      .eq('id', id);
  }
  const studentTg = lesson.telegram_id as number | null;
  if (typeof studentTg === 'number' && studentTg > 0) {
    await notifyStudentLessonCancelled(auth.admin, studentTg, {
      kind: lesson.kind as 'individual' | 'group',
      topic: lesson.topic as string,
      startsAt: lesson.starts_at as string,
    });
  }

  await logAdminAction(auth.admin, {
    actorTelegramId: auth.telegramId,
    action: 'lesson.cancel',
    entityType: 'scheduled_lesson',
    entityId: id,
    targetTelegramId: teacherTelegramId,
    detail: cancelReason ? { reason: cancelReason } : undefined,
  });

  revalidatePath('/cabinet/staff');
  revalidatePath('/cabinet/admin/schedule');
  return NextResponse.json({ ok: true });
}
