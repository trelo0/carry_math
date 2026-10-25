import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import type { TeacherRosterStudent } from '@/lib/teacher/cabinet-data';

type Body = {
  id?: number;
  name?: string;
  phone?: string | null;
  classLabel?: string | null;
  initialScore?: number | string | null;
  notes?: string | null;
};

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

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseScore(value: Body['initialScore']): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const score = Number(String(value).replace(',', '.'));
  return Number.isFinite(score) ? score : 'invalid';
}

async function authorize() {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) return null;
  return auth;
}

function fail(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Ошибка сервера';
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as Body;
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'Укажите имя ученика' }, { status: 400 });
    const score = parseScore(body.initialScore);
    if (score === 'invalid') {
      return NextResponse.json({ error: 'Оценка должна быть числом' }, { status: 400 });
    }
    const { data, error } = await auth.admin
      .from('schedule_students')
      .insert({
        teacher_telegram_id: auth.telegramId,
        name,
        phone: clean(body.phone),
        class_label: clean(body.classLabel),
        initial_score: score,
        notes: clean(body.notes),
      })
      .select(COLUMNS)
      .single();
    if (error) return fail(error, 400);
    return NextResponse.json({ student: toView(data) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await authorize();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as Body;
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'Укажите имя ученика' }, { status: 400 });
    const score = parseScore(body.initialScore);
    if (score === 'invalid') {
      return NextResponse.json({ error: 'Оценка должна быть числом' }, { status: 400 });
    }
    const { data, error } = await auth.admin
      .from('schedule_students')
      .update({
        name,
        phone: clean(body.phone),
        class_label: clean(body.classLabel),
        initial_score: score,
        notes: clean(body.notes),
      })
      .eq('id', body.id)
      .eq('teacher_telegram_id', auth.telegramId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) return fail(error, 400);
    if (!data) return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 });
    // Имя в уже созданных занятиях подтягивается из списка, но дублируем его для устойчивости.
    await auth.admin
      .from('scheduled_lessons')
      .update({ participant_name: name })
      .eq('schedule_student_id', body.id)
      .eq('teacher_telegram_id', auth.telegramId);
    return NextResponse.json({ student: toView(data) });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE ?id=…&withLessons=1 — withLessons удаляет и будущие запланированные занятия ученика. */
export async function DELETE(request: Request) {
  const auth = await authorize();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    let removedLessonIds: number[] = [];
    if (url.searchParams.get('withLessons') === '1') {
      const { data, error } = await auth.admin
        .from('scheduled_lessons')
        .delete()
        .eq('schedule_student_id', id)
        .eq('teacher_telegram_id', auth.telegramId)
        .eq('status', 'scheduled')
        .gte('starts_at', new Date().toISOString())
        .select('id');
      if (error) return fail(error, 400);
      removedLessonIds = (data ?? []).map((row) => row.id as number);
    }
    const { error } = await auth.admin
      .from('schedule_students')
      .delete()
      .eq('id', id)
      .eq('teacher_telegram_id', auth.telegramId);
    if (error) return fail(error, 400);
    return NextResponse.json({ ok: true, removedLessonIds });
  } catch (error) {
    return fail(error);
  }
}
