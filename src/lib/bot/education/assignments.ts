import type { SupabaseClient } from '@supabase/supabase-js';
import type { EducationStatus } from './courses';
import { getStudentGroups } from './groups';
import { loadMemberRoles, memberHasRole } from '@/lib/bot/roles';

// ---------------------------------------------------------------------------
// Персональные назначения: ученик ↔ преподаватель/куратор
// (mentor_assignments; mentor — техническое имя связи, не роль).
//
// user_accesses.product = 'individual' означает лишь право на формат;
// конкретный преподаватель ученика живёт здесь.
// ---------------------------------------------------------------------------

export type AssignmentKind = 'teacher' | 'curator';

export type MentorAssignment = {
  id: number;
  telegram_id: number;
  mentor_telegram_id: number;
  kind: AssignmentKind;
  status: EducationStatus;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

// Результат «мой преподаватель» / «мой куратор»: кто и откуда взят.
export type StudentMentor = {
  telegramId: number;
  fullName: string | null;
  source: 'personal' | 'group';
};

const ASSIGNMENT_COLUMNS =
  'id, telegram_id, mentor_telegram_id, kind, status, started_at, ended_at, created_at, updated_at';

// Валидация роли на сервере (не полагаемся на Telegram UI):
// kind = 'teacher' требует роль teacher, kind = 'curator' — curator.
async function assertMentorRole(
  admin: SupabaseClient,
  mentorTelegramId: number,
  kind: AssignmentKind,
): Promise<void> {
  const roles = await loadMemberRoles(admin, mentorTelegramId);
  if (roles.length === 0 || (roles.length === 1 && roles[0] === 'guest')) {
    throw new Error(`Наставник ${mentorTelegramId} не зарегистрирован в боте.`);
  }
  const ok =
    kind === 'teacher' ? memberHasRole(roles, 'teacher') : memberHasRole(roles, 'curator');
  if (!ok) {
    throw new Error(
      `Назначение kind='${kind}' недоступно для пользователя ${mentorTelegramId} (роли: ${roles.join(', ')}).`,
    );
  }
}

async function assign(
  admin: SupabaseClient,
  telegramId: number,
  mentorTelegramId: number,
  kind: AssignmentKind,
  options: { startedAt?: string } = {},
): Promise<MentorAssignment> {
  await assertMentorRole(admin, mentorTelegramId, kind);

  const now = new Date().toISOString();

  // У ученика одно активное назначение каждого типа: предыдущее завершаем
  // статусом completed (история сохраняется), затем выдаём новое.
  const { error: closeError } = await admin
    .from('mentor_assignments')
    .update({ status: 'completed', ended_at: now, updated_at: now })
    .eq('telegram_id', telegramId)
    .eq('kind', kind)
    .eq('status', 'active');
  if (closeError) throw closeError;

  const { data, error } = await admin
    .from('mentor_assignments')
    .upsert(
      {
        telegram_id: telegramId,
        mentor_telegram_id: mentorTelegramId,
        kind,
        status: 'active',
        started_at: options.startedAt ?? now,
        ended_at: null,
        updated_at: now,
      },
      { onConflict: 'telegram_id,kind,mentor_telegram_id' },
    )
    .select(ASSIGNMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as MentorAssignment;
}

export async function assignTeacher(
  admin: SupabaseClient,
  telegramId: number,
  teacherTelegramId: number,
  options: { startedAt?: string } = {},
): Promise<MentorAssignment> {
  return assign(admin, telegramId, teacherTelegramId, 'teacher', options);
}

export async function assignCurator(
  admin: SupabaseClient,
  telegramId: number,
  curatorTelegramId: number,
  options: { startedAt?: string } = {},
): Promise<MentorAssignment> {
  return assign(admin, telegramId, curatorTelegramId, 'curator', options);
}

// Снятие назначения: запись сохраняется как cancelled.
// Возвращает false, если активного назначения этого типа нет.
export async function removeAssignment(
  admin: SupabaseClient,
  telegramId: number,
  kind: AssignmentKind,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('mentor_assignments')
    .update({ status: 'cancelled', ended_at: now, updated_at: now })
    .eq('telegram_id', telegramId)
    .eq('kind', kind)
    .eq('status', 'active')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function getStudentAssignments(
  admin: SupabaseClient,
  telegramId: number,
  kind?: AssignmentKind,
): Promise<MentorAssignment[]> {
  let query = admin
    .from('mentor_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('telegram_id', telegramId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MentorAssignment[];
}

async function memberName(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return (data?.full_name as string | null | undefined) ?? null;
}

// «Мой преподаватель»: сначала персональное назначение
// (mentor_assignments.kind = 'teacher', status = 'active'),
// иначе — преподаватель активной группы ученика.
export async function getStudentTeacher(
  admin: SupabaseClient,
  telegramId: number,
  options?: { assignmentsOnly?: boolean },
): Promise<StudentMentor | null> {
  const assignments = await getStudentAssignments(admin, telegramId, 'teacher');
  const personal = assignments[0];
  if (personal) {
    return {
      telegramId: personal.mentor_telegram_id,
      fullName: await memberName(admin, personal.mentor_telegram_id),
      source: 'personal',
    };
  }

  for (const group of await getStudentGroups(admin, telegramId)) {
    if (group.teacher_telegram_id) {
      return {
        telegramId: group.teacher_telegram_id,
        fullName: await memberName(admin, group.teacher_telegram_id),
        source: 'group',
      };
    }
  }

  if (options?.assignmentsOnly) {
    return null;
  }

  const { data: lessonRow } = await admin
    .from('scheduled_lessons')
    .select('teacher_telegram_id')
    .eq('telegram_id', telegramId)
    .not('teacher_telegram_id', 'is', null)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromLesson = lessonRow?.teacher_telegram_id as number | null | undefined;
  if (fromLesson) {
    return {
      telegramId: fromLesson,
      fullName: await memberName(admin, fromLesson),
      source: 'personal',
    };
  }

  return null;
}

/** Преподаватели ordinary-занятий ученика (назначение + группы + факт из расписания). */
export async function getStudentOrdinaryTeacherIds(
  admin: SupabaseClient,
  telegramId: number,
): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const row of await getStudentAssignments(admin, telegramId, 'teacher')) {
    ids.add(row.mentor_telegram_id);
  }
  for (const group of await getStudentGroups(admin, telegramId)) {
    if (group.teacher_telegram_id) ids.add(group.teacher_telegram_id);
  }
  const { data: lessonTeachers } = await admin
    .from('scheduled_lessons')
    .select('teacher_telegram_id')
    .eq('telegram_id', telegramId)
    .not('teacher_telegram_id', 'is', null)
    .neq('status', 'cancelled');
  for (const row of lessonTeachers ?? []) {
    const id = row.teacher_telegram_id as number | null;
    if (id) ids.add(id);
  }
  return ids;
}

// «Мой куратор»: сначала персональное назначение
// (mentor_assignments.kind = 'curator', status = 'active'),
// иначе — куратор активной группы ученика.
export async function getStudentCurator(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentMentor | null> {
  const assignments = await getStudentAssignments(admin, telegramId, 'curator');
  const personal = assignments[0];
  if (personal) {
    return {
      telegramId: personal.mentor_telegram_id,
      fullName: await memberName(admin, personal.mentor_telegram_id),
      source: 'personal',
    };
  }

  for (const group of await getStudentGroups(admin, telegramId)) {
    if (group.curator_telegram_id) {
      return {
        telegramId: group.curator_telegram_id,
        fullName: await memberName(admin, group.curator_telegram_id),
        source: 'group',
      };
    }
  }
  return null;
}
