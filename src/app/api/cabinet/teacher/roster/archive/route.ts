import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { cancelScheduledLesson } from '@/lib/bot/lessons';
import type { TeacherRosterStudent } from '@/lib/teacher/cabinet-data';

const COLUMNS = 'id, name, phone, class_label, initial_score, notes, archived_at';

function toView(row: Record<string, unknown>): TeacherRosterStudent {
  return {
    id: row.id as number,
    name: row.name as string,
    phone: (row.phone as string | null) ?? null,
    classLabel: (row.class_label as string | null) ?? null,
    initialScore: row.initial_score == null ? null : Number(row.initial_score),
    notes: (row.notes as string | null) ?? '',
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      id?: number;
      restore?: boolean;
      cancelFutureLessons?: boolean;
    };
    const id = body.id;
    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    let cancelledLessonIds: number[] = [];
    if (body.cancelFutureLessons && !body.restore) {
      const now = new Date().toISOString();
      const { data: lessons } = await auth.admin
        .from('scheduled_lessons')
        .select('id')
        .eq('schedule_student_id', id)
        .eq('teacher_telegram_id', auth.telegramId)
        .eq('status', 'scheduled')
        .gte('starts_at', now);
      for (const row of lessons ?? []) {
        const lessonId = row.id as number;
        const ok = await cancelScheduledLesson(auth.admin, lessonId);
        if (ok) {
          await auth.admin
            .from('scheduled_lessons')
            .update({
              cancel_reason: 'Архив ученика',
              updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId)
            .eq('teacher_telegram_id', auth.telegramId);
          cancelledLessonIds.push(lessonId);
        }
      }
    }

    const { data, error } = await auth.admin
      .from('schedule_students')
      .update({ archived_at: body.restore ? null : new Date().toISOString() })
      .eq('id', id)
      .eq('teacher_telegram_id', auth.telegramId)
      .select(COLUMNS)
      .maybeSingle();

    if (error) {
      const message = error.message.includes('archived_at')
        ? 'Архивация недоступна: примените миграцию schedule_students_archived.sql'
        : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (!data) return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 });

    revalidatePath('/cabinet/staff');
    return NextResponse.json({ student: toView(data), cancelledLessonIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка сервера' },
      { status: 500 },
    );
  }
}
