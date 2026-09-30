import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet, hasFullStaffPreview } from '@/lib/bot/roles';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';
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

  const body = (await request.json()) as { status?: 'completed' };
  const status = body.status;
  if (status !== 'completed') {
    return NextResponse.json({ error: 'status must be completed' }, { status: 400 });
  }

  const { data: lesson } = await auth.admin
    .from('scheduled_lessons')
    .select('id, teacher_telegram_id, telegram_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  const lessonTeacherId = lesson.teacher_telegram_id as number | null;
  const studentId = lesson.telegram_id as number | null;
  const isLessonTeacher = lessonTeacherId === auth.telegramId;
  const staffPreview = hasFullStaffPreview(auth.roles, auth.telegramId);
  if (!isLessonTeacher && !staffPreview) {
    const ownsStudent =
      typeof studentId === 'number' &&
      (await teacherOwnsStudent(auth.admin, auth.telegramId, studentId));
    if (!ownsStudent) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  if (lesson.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Изменить статус можно только у запланированного занятия' },
      { status: 409 },
    );
  }

  try {
    await completeScheduledLesson(auth.admin, id, auth.telegramId);
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
