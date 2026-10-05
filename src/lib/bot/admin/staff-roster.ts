import type { SupabaseClient } from '@supabase/supabase-js';
import {
  combineMemberRoles,
  loadMemberRoles,
  memberHasRole,
  normalizeMemberRole,
  roleLabel,
  type BotRole,
} from '@/lib/bot/roles';
import type { MemberRow } from '@/lib/bot/roles';

export type StaffMemberRow = MemberRow & { extra_roles?: string[] | null };

const STAFF_PRIMARY = ['teacher', 'curator', 'mentor', 'admin'] as const;

export function memberRolesSummary(primary: string, extraRoles: string[] | null | undefined): string {
  const roles = combineMemberRoles(primary, extraRoles ?? []);
  const labels = [...new Set(roles.map((r) => roleLabel(r)))];
  return labels.join(' · ');
}

export function isStaffMember(primary: string, extraRoles: string[] | null | undefined): boolean {
  const roles = combineMemberRoles(primary, extraRoles ?? []);
  return roles.some((r) => r === 'teacher' || r === 'curator' || r === 'admin');
}

export async function memberCanActAsKind(
  admin: SupabaseClient,
  telegramId: number,
  kind: 'teacher' | 'curator',
): Promise<boolean> {
  const roles = await loadMemberRoles(admin, telegramId);
  if (kind === 'teacher') return memberHasRole(roles, 'teacher');
  return memberHasRole(roles, 'curator');
}

/** Все, кто может быть наставником (primary + extra_roles). */
export async function listMentorPickerCandidates(
  admin: SupabaseClient,
  kind: 'teacher' | 'curator',
): Promise<Array<{ telegram_id: number; full_name: string | null; rolesLine: string }>> {
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id, full_name, role, extra_roles')
    .or('role.in.(teacher,curator,mentor,admin),extra_roles.ov.{teacher},extra_roles.ov.{curator}')
    .order('full_name', { ascending: true })
    .limit(200);
  if (error) {
    const fallback = await admin
      .from('bot_members')
      .select('telegram_id, full_name, role, extra_roles')
      .in('role', ['teacher', 'curator', 'mentor', 'admin'])
      .limit(200);
    if (fallback.error) throw fallback.error;
    return filterMentorCandidates((fallback.data ?? []) as StaffMemberRow[], kind);
  }
  return filterMentorCandidates((data ?? []) as StaffMemberRow[], kind);
}

function filterMentorCandidates(
  rows: StaffMemberRow[],
  kind: 'teacher' | 'curator',
): Array<{ telegram_id: number; full_name: string | null; rolesLine: string }> {
  const out: Array<{ telegram_id: number; full_name: string | null; rolesLine: string }> = [];
  for (const row of rows) {
    const roles = combineMemberRoles(row.role, row.extra_roles ?? []);
    const ok =
      kind === 'teacher'
        ? memberHasRole(roles, 'teacher')
        : memberHasRole(roles, 'curator');
    if (!ok) continue;
    out.push({
      telegram_id: row.telegram_id,
      full_name: row.full_name,
      rolesLine: memberRolesSummary(row.role, row.extra_roles ?? []),
    });
  }
  return out;
}

export async function listStaffMembers(
  admin: SupabaseClient,
  page: number,
  perPage: number,
): Promise<{ members: StaffMemberRow[]; total: number }> {
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id, role, phone, full_name, chat_id, extra_roles')
    .or('role.in.(teacher,curator,mentor,admin),extra_roles.ov.{teacher},extra_roles.ov.{curator}')
    .order('full_name', { ascending: true })
    .limit(400);
  if (error) {
    const { data: fallback, error: err2 } = await admin
      .from('bot_members')
      .select('telegram_id, role, phone, full_name, chat_id, extra_roles')
      .in('role', [...STAFF_PRIMARY])
      .limit(400);
    if (err2) throw err2;
    const filtered = (fallback ?? []).filter((r) =>
      isStaffMember(String(r.role), r.extra_roles as string[] | null),
    ) as StaffMemberRow[];
    return paginate(filtered, page, perPage);
  }
  const filtered = (data ?? []).filter((r) =>
    isStaffMember(String(r.role), r.extra_roles as string[] | null),
  ) as StaffMemberRow[];
  return paginate(filtered, page, perPage);
}

function paginate<T>(items: T[], page: number, perPage: number): { members: T[]; total: number } {
  const total = items.length;
  const from = page * perPage;
  return { members: items.slice(from, from + perPage), total };
}

export async function loadStaffStats(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ studentsAsTeacher: number; studentsAsCurator: number; groupsTeacher: number; groupsCurator: number }> {
  const [{ count: tCount }, { count: cCount }, { count: gt }, { count: gc }] = await Promise.all([
    admin
      .from('mentor_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('mentor_telegram_id', telegramId)
      .eq('kind', 'teacher')
      .eq('status', 'active'),
    admin
      .from('mentor_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('mentor_telegram_id', telegramId)
      .eq('kind', 'curator')
      .eq('status', 'active'),
    admin.from('groups').select('id', { count: 'exact', head: true }).eq('teacher_telegram_id', telegramId),
    admin.from('groups').select('id', { count: 'exact', head: true }).eq('curator_telegram_id', telegramId),
  ]);
  return {
    studentsAsTeacher: tCount ?? 0,
    studentsAsCurator: cCount ?? 0,
    groupsTeacher: gt ?? 0,
    groupsCurator: gc ?? 0,
  };
}

export const EXTRA_ASSIGNABLE: BotRole[] = ['student', 'teacher', 'curator'];

export async function getMemberWithExtras(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StaffMemberRow | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id, role, phone, full_name, chat_id, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as StaffMemberRow;
}

export function formatExtraRolesList(extra: string[] | null | undefined): string {
  if (!extra?.length) return '—';
  return extra.map((r) => roleLabel(normalizeMemberRole(r))).join(', ');
}
