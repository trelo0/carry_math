import type { SupabaseClient } from '@supabase/supabase-js';
import type { EducationStatus } from './courses';

// ---------------------------------------------------------------------------
// Группы и состав групп (groups, group_members)
//
// user_accesses.product = 'group' означает лишь право на формат;
// конкретная группа ученика живёт здесь. Преподаватель и куратор группы
// хранятся в самой группе; персональные назначения — в mentor_assignments.
// ---------------------------------------------------------------------------

export type Group = {
  id: number;
  title: string;
  course_id: number | null;
  teacher_telegram_id: number | null;
  curator_telegram_id: number | null;
  status: EducationStatus;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupMemberRow = {
  id: number;
  group_id: number;
  telegram_id: number;
  status: EducationStatus;
  joined_at: string;
  left_at: string | null;
  created_at: string;
  updated_at: string;
};

// Участник группы с именем из bot_members (для списков состава).
export type GroupMemberWithProfile = GroupMemberRow & {
  full_name: string | null;
};

// «Моя группа»: активная группа с данными членства ученика.
export type StudentGroup = Group & {
  membership: Pick<GroupMemberRow, 'status' | 'joined_at'>;
};

const GROUP_COLUMNS =
  'id, title, course_id, teacher_telegram_id, curator_telegram_id, status, started_at, ended_at, created_at, updated_at';

export async function getGroup(admin: SupabaseClient, groupId: number): Promise<Group | null> {
  const { data, error } = await admin
    .from('groups')
    .select(GROUP_COLUMNS)
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as Group) : null;
}

export async function createGroup(
  admin: SupabaseClient,
  input: {
    title: string;
    courseId?: number | null;
    teacherTelegramId?: number | null;
    curatorTelegramId?: number | null;
    startedAt?: string;
  },
): Promise<Group> {
  const { data, error } = await admin
    .from('groups')
    .insert({
      title: input.title,
      course_id: input.courseId ?? null,
      teacher_telegram_id: input.teacherTelegramId ?? null,
      curator_telegram_id: input.curatorTelegramId ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
    })
    .select(GROUP_COLUMNS)
    .single();
  if (error) throw error;
  return data as Group;
}

export async function updateGroup(
  admin: SupabaseClient,
  groupId: number,
  patch: Partial<Pick<Group, 'title' | 'course_id' | 'teacher_telegram_id' | 'curator_telegram_id' | 'status' | 'ended_at'>>,
): Promise<Group> {
  const { data, error } = await admin
    .from('groups')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .select(GROUP_COLUMNS)
    .single();
  if (error) throw error;
  return data as Group;
}

// Состав группы с именами участников.
export async function getGroupMembers(
  admin: SupabaseClient,
  groupId: number,
  options: { onlyActive?: boolean } = {},
): Promise<GroupMemberWithProfile[]> {
  const onlyActive = options.onlyActive ?? true;
  let query = admin
    .from('group_members')
    .select('id, group_id, telegram_id, status, joined_at, left_at, created_at, updated_at, bot_members(full_name)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });
  if (onlyActive) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { bot_members, ...member } = row as unknown as GroupMemberRow & {
      bot_members: { full_name: string | null } | null;
    };
    return { ...member, full_name: bot_members?.full_name ?? null };
  });
}

// Добавление ученика в группу: новая запись или возврат после выхода
// (unique-индекс group_id + telegram_id).
export async function addStudentToGroup(
  admin: SupabaseClient,
  groupId: number,
  telegramId: number,
): Promise<GroupMemberRow> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('group_members')
    .upsert(
      {
        group_id: groupId,
        telegram_id: telegramId,
        status: 'active',
        joined_at: now,
        left_at: null,
        updated_at: now,
      },
      { onConflict: 'group_id,telegram_id' },
    )
    .select('id, group_id, telegram_id, status, joined_at, left_at, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as GroupMemberRow;
}

// Выход/исключение из группы: запись сохраняется как cancelled.
export async function removeStudentFromGroup(
  admin: SupabaseClient,
  groupId: number,
  telegramId: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('group_members')
    .update({ status: 'cancelled', left_at: now, updated_at: now })
    .eq('group_id', groupId)
    .eq('telegram_id', telegramId)
    .eq('status', 'active')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Активные группы ученика — источник для «Моя группа».
// Ученик в группе активен И сама группа активна.
export async function getStudentGroups(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentGroup[]> {
  const { data: members, error: membersError } = await admin
    .from('group_members')
    .select('group_id, status, joined_at')
    .eq('telegram_id', telegramId)
    .eq('status', 'active');
  if (membersError) throw membersError;

  const groupIds = (members ?? []).map((row) => row.group_id);
  if (groupIds.length === 0) return [];

  const { data: groups, error: groupsError } = await admin
    .from('groups')
    .select(GROUP_COLUMNS)
    .in('id', groupIds)
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  if (groupsError) throw groupsError;

  const membershipByGroup = new Map((members ?? []).map((row) => [row.group_id, row]));
  return (groups ?? []).map((group) => {
    const membership = membershipByGroup.get(group.id);
    return {
      ...(group as Group),
      membership: {
        status: membership?.status ?? 'active',
        joined_at: membership?.joined_at ?? '',
      } as Pick<GroupMemberRow, 'status' | 'joined_at'>,
    };
  });
}
