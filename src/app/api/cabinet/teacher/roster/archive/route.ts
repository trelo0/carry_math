import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
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
    const body = (await request.json()) as { id?: number; restore?: boolean };
    const id = body.id;
    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
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
    return NextResponse.json({ student: toView(data) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка сервера' },
      { status: 500 },
    );
  }
}
