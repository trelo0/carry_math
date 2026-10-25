import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { durationFromRange } from '@/lib/teacher/schedule-utils';

const MAX_OCCURRENCES = 60;

type LessonSlot = { startsAt: string; durationMinutes: number };

type Body = {
  kind?: 'individual' | 'group';
  scheduleStudentId?: number;
  participantName?: string;
  topic?: string;
  lessonPlan?: string;
  /** Каждый слот — своё начало и длительность. */
  slots?: LessonSlot[];
  /** Даты начала (legacy, одна durationMinutes на все). */
  occurrences?: string[];
  endTime?: string;
  durationMinutes?: number;
};

/** Создание серии еженедельных занятий: занятия самостоятельны, переносятся и отменяются по одному. */
export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const kind = body.kind === 'group' ? 'group' : 'individual';

    let slots: LessonSlot[] = [];
    if (body.slots?.length) {
      const byStart = new Map<string, number>();
      for (const slot of body.slots) {
        if (!slot.startsAt || !Number.isFinite(slot.durationMinutes)) continue;
        const dm = Math.max(1, Math.min(24 * 60, Math.floor(slot.durationMinutes)));
        byStart.set(slot.startsAt, dm);
      }
      slots = [...byStart.entries()]
        .map(([startsAt, durationMinutes]) => ({ startsAt, durationMinutes }))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    } else {
      const occurrences = [...new Set(body.occurrences ?? [])].sort();
      if (occurrences.length === 0) {
        return NextResponse.json({ error: 'occurrences or slots required' }, { status: 400 });
      }
      if (body.durationMinutes == null && !body.endTime) {
        return NextResponse.json({ error: 'endTime or durationMinutes required' }, { status: 400 });
      }
      let durationMinutes = body.durationMinutes;
      if (durationMinutes == null || !Number.isFinite(durationMinutes)) {
        const firstStart = new Date(occurrences[0]);
        const startTime = `${String(firstStart.getHours()).padStart(2, '0')}:${String(firstStart.getMinutes()).padStart(2, '0')}`;
        durationMinutes = durationFromRange(startTime, body.endTime!);
      }
      durationMinutes = Math.max(1, Math.min(24 * 60, Math.floor(durationMinutes)));
      slots = occurrences.map((startsAt) => ({ startsAt, durationMinutes }));
    }

    if (slots.length === 0) {
      return NextResponse.json({ error: 'occurrences or slots required' }, { status: 400 });
    }
    if (slots.length > MAX_OCCURRENCES) {
      return NextResponse.json({ error: 'Слишком много занятий в серии' }, { status: 400 });
    }

    let participantName = body.participantName?.trim() || null;
    let scheduleStudentId: number | null = null;
    if (kind === 'individual' && body.scheduleStudentId) {
      const { data: student } = await auth.admin
        .from('schedule_students')
        .select('id, name')
        .eq('id', body.scheduleStudentId)
        .eq('teacher_telegram_id', auth.telegramId)
        .is('archived_at', null)
        .maybeSingle();
      if (!student) return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 });
      scheduleStudentId = student.id as number;
      participantName = student.name as string;
    }

    const results = await Promise.all(
      slots.map(async ({ startsAt, durationMinutes }) => {
        try {
          await validateLessonSlot(auth.admin, auth.telegramId, { startsAt, durationMinutes });
          return { startsAt, durationMinutes, error: null as string | null };
        } catch (error) {
          if (error instanceof ScheduleValidationError) return { startsAt, durationMinutes, error: error.message };
          throw error;
        }
      }),
    );
    const valid = results.filter((r) => !r.error);
    const skipped = results
      .filter((r) => r.error)
      .map((r) => ({ startsAt: r.startsAt, reason: r.error as string }));

    if (valid.length === 0) {
      return NextResponse.json(
        { error: skipped[0]?.reason ?? 'Не удалось создать занятия', skipped },
        { status: 409 },
      );
    }

    const seriesId = randomUUID();
    const topic = body.topic?.trim() || (kind === 'group' ? 'Групповое занятие' : 'Индивидуальное занятие');
    const lessons: { id: number; startsAt: string }[] = [];
    for (const slot of valid) {
      const { data: row, error } = await auth.admin
        .from('scheduled_lessons')
        .insert({
          telegram_id: null,
          kind,
          group_id: null,
          teacher_telegram_id: auth.telegramId,
          starts_at: slot.startsAt,
          duration_minutes: slot.durationMinutes,
          topic,
          status: 'scheduled',
          package_id: null,
          lesson_plan: body.lessonPlan?.trim() || null,
          participant_name: participantName,
          schedule_student_id: scheduleStudentId,
          series_id: seriesId,
        })
        .select('id, starts_at')
        .single();
      if (error) {
        skipped.push({ startsAt: slot.startsAt, reason: error.message });
        continue;
      }
      lessons.push({ id: row.id as number, startsAt: row.starts_at as string });
    }

    revalidatePath('/cabinet/staff');
    return NextResponse.json({
      seriesId,
      lessons,
      skipped,
      created: lessons.length,
      requested: slots.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось создать серию' },
      { status: 500 },
    );
  }
}
