import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { completeScheduledLesson } from '@/lib/bot/lessons';
import { loadTeacherOwnedLesson } from '@/lib/teacher/lesson-ownership';

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

  const body = (await request.json()) as { status?: 'completed' };
  const status = body.status;
  if (status !== 'completed') {
    return NextResponse.json({ error: 'status must be completed' }, { status: 400 });
  }

  const lesson = await loadTeacherOwnedLesson(
    auth.admin,
    auth.telegramId,
    id,
    'id, status',
  );
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  if (lesson.status === 'completed') {
    return NextResponse.json({ ok: true, alreadyCompleted: true });
  }
  if (lesson.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Изменить статус можно только у запланированного занятия' },
      { status: 409 },
    );
  }

  try {
    await completeScheduledLesson(auth.admin, id, auth.telegramId, {
      ownerTeacherTelegramId: auth.telegramId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Complete failed' },
      { status: 400 },
    );
  }

  revalidatePath('/cabinet/staff');
  revalidatePath('/cabinet');
  return NextResponse.json({ ok: true });
}
