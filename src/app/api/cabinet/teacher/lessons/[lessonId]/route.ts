import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { getTeacherLessonDetail } from '@/lib/teacher/lesson-detail';

export async function GET(
  _request: Request,
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

  try {
    const detail = await getTeacherLessonDetail(auth.admin, auth.telegramId, id);
    if (!detail) {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lesson' },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

  const body = (await request.json()) as {
    meetUrl?: string | null;
    boardUrl?: string | null;
    lessonPlan?: string | null;
    topic?: string;
  };

  const patch: Record<string, string | null> = { updated_at: new Date().toISOString() };
  if ('meetUrl' in body) patch.meet_url = body.meetUrl?.trim() || null;
  if ('boardUrl' in body) patch.board_url = body.boardUrl?.trim() || null;
  if ('lessonPlan' in body) patch.lesson_plan = body.lessonPlan?.trim() || null;
  if (body.topic !== undefined) patch.topic = body.topic.trim() || 'Занятие';

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from('scheduled_lessons')
    .update(patch)
    .eq('id', id)
    .eq('teacher_telegram_id', auth.telegramId)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
