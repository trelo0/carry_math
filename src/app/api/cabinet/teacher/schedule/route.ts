import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { scheduleLesson } from '@/lib/bot/lessons';
import { assertLessonCreditAvailable, LessonCreditError } from '@/lib/bot/lesson-credits';
import { notifyStudentLessonScheduled } from '@/lib/bot/student-notifications';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { durationFromRange } from '@/lib/teacher/schedule-utils';

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    studentTelegramId?: number;
    kind?: 'individual' | 'group';
    startsAt?: string;
    topic?: string;
    packageId?: number;
    meetUrl?: string;
    groupId?: number;
    durationMinutes?: number;
    endTime?: string;
    lessonPlan?: string;
    fromSlotId?: number;
  };

  const { admin, telegramId } = auth;
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

  if (kind === 'individual' && !body.studentTelegramId) {
    const { data, error } = await auth.admin
      .from('scheduled_lessons')
      .insert({
        telegram_id: null,
        kind: 'individual',
        teacher_telegram_id: auth.telegramId,
        starts_at: startsAt,
        duration_minutes: durationMinutes,
        topic,
        status: 'scheduled',
        package_id: null,
        lesson_plan: body.lessonPlan?.trim() || null,
      })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await consumeFreeSlot(body.fromSlotId);
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ lessonId: data.id });
  }

  if (kind === 'group' && !body.groupId && !body.studentTelegramId) {
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
      })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await consumeFreeSlot(body.fromSlotId);
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ lessonId: data.id });
  }

  if (kind === 'group' && body.groupId && !body.studentTelegramId) {
    const groupId = body.groupId;
    const { data: group } = await auth.admin
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('teacher_telegram_id', auth.telegramId)
      .maybeSingle();
    if (!group) {
      return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 });
    }

    const { data: members } = await auth.admin
      .from('group_members')
      .select('telegram_id')
      .eq('group_id', groupId)
      .eq('status', 'active');
    if (!members?.length) {
      return NextResponse.json({ error: 'В группе нет активных учеников' }, { status: 400 });
    }

    const lessonIds: number[] = [];
    const skipped: string[] = [];

    for (const member of members) {
      const telegramId = member.telegram_id as number;
      let packageId: number;
      try {
        ({ packageId } = await assertLessonCreditAvailable(
          auth.admin,
          telegramId,
          'group',
          body.packageId,
        ));
      } catch (error) {
        if (error instanceof LessonCreditError) {
          skipped.push(String(telegramId));
          continue;
        }
        throw error;
      }
      try {
        const lessonId = await scheduleLesson(auth.admin, {
          telegramId,
          kind: 'group',
          startsAt,
          topic,
          packageId,
          teacherTelegramId: auth.telegramId,
          groupId,
          meetUrl: body.meetUrl,
          durationMinutes,
        });
        lessonIds.push(lessonId);
        if (body.lessonPlan?.trim()) {
          await auth.admin
            .from('scheduled_lessons')
            .update({ lesson_plan: body.lessonPlan.trim() })
            .eq('id', lessonId);
        }
        await notifyStudentLessonScheduled(auth.admin, telegramId, {
          kind: 'group',
          topic,
          startsAt,
          meetUrl: body.meetUrl,
        });
      } catch (error) {
        skipped.push(
          error instanceof Error ? error.message : String(telegramId),
        );
      }
    }

    if (lessonIds.length === 0) {
      return NextResponse.json(
        {
          error:
            skipped.length > 0
              ? 'Не удалось назначить ни одному ученику группы (нет пакетов или ошибка)'
              : 'Не удалось назначить занятие',
        },
        { status: 400 },
      );
    }

    await consumeFreeSlot(body.fromSlotId);
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ lessonIds, skippedCount: skipped.length });
  }

  const studentTelegramId = body.studentTelegramId;
  if (!studentTelegramId) {
    return NextResponse.json({ error: 'studentTelegramId required' }, { status: 400 });
  }

  const ownsStudent = await teacherOwnsStudent(auth.admin, auth.telegramId, studentTelegramId);
  if (!ownsStudent) {
    return NextResponse.json({ error: 'Нет доступа к этому ученику' }, { status: 403 });
  }

  let packageId: number;
  try {
    ({ packageId } = await assertLessonCreditAvailable(
      auth.admin,
      studentTelegramId,
      kind,
      body.packageId,
    ));
  } catch (error) {
    if (error instanceof LessonCreditError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const lessonId = await scheduleLesson(auth.admin, {
      telegramId: studentTelegramId,
      kind,
      startsAt,
      topic,
      packageId,
      teacherTelegramId: auth.telegramId,
      groupId: body.groupId,
      meetUrl: body.meetUrl,
      durationMinutes,
    });
    if (body.lessonPlan?.trim()) {
      await auth.admin
        .from('scheduled_lessons')
        .update({ lesson_plan: body.lessonPlan.trim() })
        .eq('id', lessonId);
    }
    await notifyStudentLessonScheduled(auth.admin, studentTelegramId, {
      kind,
      topic,
      startsAt,
      meetUrl: body.meetUrl,
    });
    await consumeFreeSlot(body.fromSlotId);
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ lessonId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schedule failed' },
      { status: 400 },
    );
  }
}
