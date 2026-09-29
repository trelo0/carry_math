import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';

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

  const body = (await request.json()) as {
    startsAt?: string;
    endTime?: string;
    durationMinutes?: number;
  };

  const startsAt = body.startsAt?.trim();
  if (!startsAt) {
    return NextResponse.json({ error: 'startsAt required' }, { status: 400 });
  }

  const { data: lesson } = await auth.admin
    .from('scheduled_lessons')
    .select('id, teacher_telegram_id, status, duration_minutes')
    .eq('id', id)
    .maybeSingle();
  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  if (lesson.teacher_telegram_id !== auth.telegramId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (lesson.status !== 'scheduled') {
    return NextResponse.json({ error: 'Перенести можно только запланированное занятие' }, { status: 400 });
  }

  let durationMinutes = body.durationMinutes ?? (lesson.duration_minutes as number) ?? 60;
  if (body.endTime) {
    const start = new Date(startsAt);
    const [eh, em] = body.endTime.split(':').map(Number);
    const endMinutes = eh * 60 + em;
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    durationMinutes = Math.max(endMinutes - startMinutes, 15);
  }

  try {
    await validateLessonSlot(auth.admin, auth.telegramId, {
      startsAt,
      durationMinutes,
      excludeLessonId: id,
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  const { error } = await auth.admin
    .from('scheduled_lessons')
    .update({
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
