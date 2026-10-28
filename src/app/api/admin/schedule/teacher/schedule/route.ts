import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { assertScheduleTeacherTarget, parseTeacherTelegramId } from '@/lib/admin/schedule-target';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { insertIndividualLessonAtomic } from '@/lib/teacher/insert-individual-lesson';
import { durationFromRange } from '@/lib/teacher/schedule-utils';

export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    teacherTelegramId?: number;
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
    studentTelegramId?: number;
    groupId?: number;
    packageId?: number;
    meetUrl?: string;
  };

  const teacherTelegramId = parseTeacherTelegramId(new URL(request.url), body);
  if (teacherTelegramId == null) {
    return NextResponse.json({ error: 'teacherTelegramId required' }, { status: 400 });
  }

  const target = await assertScheduleTeacherTarget(auth.admin, teacherTelegramId);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  const { admin } = auth;
  const telegramId = teacherTelegramId;

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
      .eq('teacher_telegram_id', telegramId)
      .is('archived_at', null)
      .maybeSingle();
    if (!rosterStudent) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 });
    }
    rosterName = rosterStudent.name as string;
  }

  let lessonId: number;

  if (kind === 'individual') {
    try {
      const created = await insertIndividualLessonAtomic(auth.admin, {
        teacherTelegramId: telegramId,
        startsAt,
        durationMinutes,
        topic,
        participantName: rosterName ?? (body.participantName?.trim() || null),
        scheduleStudentId: rosterName ? (body.scheduleStudentId ?? null) : null,
        lessonPlan: body.lessonPlan?.trim() || null,
      });
      lessonId = created.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось создать занятие';
      const status = message.includes('уже назначено') ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  } else {
    const { data, error } = await auth.admin
      .from('scheduled_lessons')
      .insert({
        telegram_id: null,
        kind: 'group',
        group_id: null,
        teacher_telegram_id: telegramId,
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
    lessonId = data.id as number;
  }

  await consumeFreeSlot(body.fromSlotId);
  await consumeReplacedLesson(body.replacesLessonId);

  await logAdminAction(auth.admin, {
    actorTelegramId: auth.telegramId,
    action: 'lesson.create',
    entityType: 'scheduled_lesson',
    entityId: lessonId,
    targetTelegramId: teacherTelegramId,
    detail: { starts_at: startsAt, kind },
  });

  revalidatePath('/cabinet/staff');
  revalidatePath('/cabinet/admin/schedule');
  return NextResponse.json({ lessonId });
}
