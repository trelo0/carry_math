import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { cancelScheduledLesson } from '@/lib/bot/lessons';
import { notifyStudentLessonCancelled } from '@/lib/teacher/notifications';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { lessonId } = await params;
  const id = Number(lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  let cancelReason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: string; reasonNote?: string };
    cancelReason = body.reasonNote?.trim() || body.reason?.trim() || null;
  } catch {
    cancelReason = null;
  }

  const { data: lesson, error: loadError } = await auth.admin
    .from('scheduled_lessons')
    .select('id, telegram_id, teacher_telegram_id, kind, topic, starts_at, status')
    .eq('id', id)
    .maybeSingle();
  if (loadError || !lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }
  if (lesson.teacher_telegram_id !== auth.telegramId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await cancelScheduledLesson(auth.admin, id);
  if (cancelReason) {
    await auth.admin
      .from('scheduled_lessons')
      .update({ cancel_reason: cancelReason, updated_at: new Date().toISOString() })
      .eq('id', id);
  }
  await notifyStudentLessonCancelled(auth.admin, lesson.telegram_id as number, {
    kind: lesson.kind as 'individual' | 'group',
    topic: lesson.topic as string,
    startsAt: lesson.starts_at as string,
  });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
