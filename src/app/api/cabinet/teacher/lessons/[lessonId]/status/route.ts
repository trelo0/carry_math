import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { completeScheduledLesson } from '@/lib/bot/lessons';

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

  const body = (await request.json()) as { status?: 'completed' | 'no_show' };
  const status = body.status;
  if (status !== 'completed' && status !== 'no_show') {
    return NextResponse.json({ error: 'status must be completed or no_show' }, { status: 400 });
  }

  const { data: lesson } = await auth.admin
    .from('scheduled_lessons')
    .select('id, teacher_telegram_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  if (lesson.teacher_telegram_id !== auth.telegramId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();

  if (status === 'completed') {
    try {
      await completeScheduledLesson(auth.admin, id, auth.telegramId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Complete failed' },
        { status: 400 },
      );
    }
  } else {
    const { error } = await auth.admin
      .from('scheduled_lessons')
      .update({ status: 'no_show', updated_at: now })
      .eq('id', id)
      .eq('status', 'scheduled');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
