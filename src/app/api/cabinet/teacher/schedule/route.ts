import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { insertIndividualLessonAtomic } from '@/lib/teacher/insert-individual-lesson';
import { durationFromRange } from '@/lib/teacher/schedule-utils';

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    participantName?: string;
    scheduleStudentId?: number;
    kind?: 'individual' | 'group';
    startsAt?: string;
    topic?: string;
    durationMinutes?: number;
    endTime?: string;
    lessonPlan?: string;
    fromSlotId?: number;
    replacesLessonId?: number;
    /** Legacy — не используется в кабинете расписания. */
    studentTelegramId?: number;
    groupId?: number;
    packageId?: number;
    meetUrl?: string;
  };

  const { admin, telegramId } = auth;

  if (body.studentTelegramId != null && Number.isFinite(body.studentTelegramId)) {
    return NextResponse.json(
      { error: 'Занятия с Telegram-учениками в этом расписании не поддерживаются' },
      { status: 400 },
    );
  }
  if (body.groupId != null && Number.isFinite(body.groupId)) {
    return NextResponse.json(
      { error: 'Используйте групповое занятие с названием, без привязки к группе из CRM' },
      { status: 400 },
    );
  }

  async function consumeReplacedLesson(replacesLessonId?: number) {
    if (!replacesLessonId || !Number.isFinite(replacesLessonId)) return;
    await admin
      .from('scheduled_lessons')
      .delete()
      .eq('id', replacesLessonId)
      .eq('teacher_telegram_id', telegramId)
      .eq('status', 'cancelled');
  }
  async function consumeFreeSlot(slotId?: number) {
    if (!slotId) return;
    await admin
      .from('teacher_day_slots')
      .delete()
      .eq('id', slotId)
      .eq('teacher_telegram_id', telegramId)
      .eq('slot_kind', 'extra');
  }

  const kind = body.kind;
  const startsAt = body.startsAt?.trim();
  let durationMinutes = body.durationMinutes ?? 60;
  if (body.endTime && startsAt) {
    const start = new Date(startsAt);
    const startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    durationMinutes = durationFromRange(startTime, body.endTime);
  }
  const topic =
    body.topic?.trim() || (kind === 'group' ? 'Групповое занятие' : 'Индивидуальное занятие');

  if (!kind || !startsAt) {
    return NextResponse.json({ error: 'kind, startsAt required' }, { status: 400 });
  }

  try {
    await validateLessonSlot(admin, telegramId, {
      startsAt,
      durationMinutes,
      fromSlotId: body.fromSlotId,
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  let rosterName: string | null = null;
  if (kind === 'individual' && body.scheduleStudentId) {
    const { data: rosterStudent } = await auth.admin
      .from('schedule_students')
      .select('id, name')
      .eq('id', body.scheduleStudentId)
      .eq('teacher_telegram_id', auth.telegramId)
      .is('archived_at', null)
      .maybeSingle();
    if (!rosterStudent) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 });
    }
    rosterName = rosterStudent.name as string;
  }

  if (kind === 'individual') {
    try {
      const { id } = await insertIndividualLessonAtomic(auth.admin, {
        teacherTelegramId: auth.telegramId,
        startsAt,
        durationMinutes,
        topic,
        participantName: rosterName ?? (body.participantName?.trim() || null),
        scheduleStudentId: rosterName ? (body.scheduleStudentId ?? null) : null,
        lessonPlan: body.lessonPlan?.trim() || null,
      });
      await consumeFreeSlot(body.fromSlotId);
      await consumeReplacedLesson(body.replacesLessonId);
      revalidatePath('/cabinet/staff');
      revalidatePath('/cabinet');
      return NextResponse.json({ lessonId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось создать занятие';
      const status = message.includes('уже назначено') ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const { data, error } = await auth.admin
    .from('scheduled_lessons')
    .insert({
      telegram_id: null,
      kind: 'group',
      group_id: null,
      teacher_telegram_id: auth.telegramId,
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      topic,
      status: 'scheduled',
      package_id: null,
      lesson_plan: body.lessonPlan?.trim() || null,
      participant_name: body.participantName?.trim() || null,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await consumeFreeSlot(body.fromSlotId);
  await consumeReplacedLesson(body.replacesLessonId);
  revalidatePath('/cabinet/staff');
  revalidatePath('/cabinet');
  return NextResponse.json({ lessonId: data.id });
}
