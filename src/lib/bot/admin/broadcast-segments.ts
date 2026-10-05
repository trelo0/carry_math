import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessProduct } from '../accesses';
import { getGroupMembers } from '../education/groups';
import { listMentorPickerCandidates } from './staff-roster';

const SEG_PREFIX = 'seg:';

export function isBroadcastSegmentId(audienceId: string): boolean {
  return audienceId.startsWith(SEG_PREFIX);
}

export function segmentTitle(audienceId: string, extra?: string): string {
  if (audienceId === 'seg:access:course') return 'Курс (активный доступ)';
  if (audienceId === 'seg:access:individual') return 'Индив. (активный доступ)';
  if (audienceId === 'seg:access:group') return 'Групповой формат (активный доступ)';
  if (audienceId.startsWith('seg:group:')) return extra ? `Группа «${extra}»` : `Группа #${audienceId.slice('seg:group:'.length)}`;
  if (audienceId.startsWith('seg:teacher:')) return extra ? `Ученики: ${extra}` : `Ученики препода #${audienceId.slice('seg:teacher:'.length)}`;
  return audienceId;
}

export function segmentAudienceLabel(audienceId: string, audienceTitle?: string | null): string {
  return audienceTitle?.trim() || segmentTitle(audienceId);
}

async function chatIdsForTelegramIds(admin: SupabaseClient, telegramIds: number[]): Promise<number[]> {
  if (telegramIds.length === 0) return [];
  const unique = [...new Set(telegramIds)];
  const chatIds: number[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await admin
      .from('bot_members')
      .select('chat_id')
      .in('telegram_id', chunk)
      .not('chat_id', 'is', null);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.chat_id) chatIds.push(row.chat_id as number);
    }
  }
  return chatIds;
}

async function telegramIdsWithActiveAccess(
  admin: SupabaseClient,
  product: AccessProduct,
): Promise<number[]> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('telegram_id')
    .eq('product', product)
    .eq('status', 'active');
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.telegram_id as number))];
}

async function telegramIdsForTeacherStudents(admin: SupabaseClient, teacherId: number): Promise<number[]> {
  const ids = new Set<number>();
  const { data: mentors, error: mErr } = await admin
    .from('mentor_assignments')
    .select('telegram_id')
    .eq('mentor_telegram_id', teacherId)
    .eq('kind', 'teacher')
    .eq('status', 'active');
  if (mErr) throw mErr;
  for (const row of mentors ?? []) ids.add(row.telegram_id as number);

  const { data: groups, error: gErr } = await admin
    .from('groups')
    .select('id')
    .eq('teacher_telegram_id', teacherId)
    .eq('status', 'active');
  if (gErr) throw gErr;
  for (const group of groups ?? []) {
    const members = await getGroupMembers(admin, group.id as number);
    for (const m of members) ids.add(m.telegram_id);
  }
  return [...ids];
}

export async function getBroadcastSegmentRecipients(
  admin: SupabaseClient,
  audienceId: string,
): Promise<number[]> {
  if (audienceId === 'seg:access:course') {
    return chatIdsForTelegramIds(admin, await telegramIdsWithActiveAccess(admin, 'course'));
  }
  if (audienceId === 'seg:access:individual') {
    return chatIdsForTelegramIds(admin, await telegramIdsWithActiveAccess(admin, 'individual'));
  }
  if (audienceId === 'seg:access:group') {
    return chatIdsForTelegramIds(admin, await telegramIdsWithActiveAccess(admin, 'group'));
  }
  if (audienceId.startsWith('seg:group:')) {
    const groupId = Number(audienceId.slice('seg:group:'.length));
    if (!Number.isFinite(groupId)) return [];
    const members = await getGroupMembers(admin, groupId);
    return chatIdsForTelegramIds(
      admin,
      members.map((m) => m.telegram_id),
    );
  }
  if (audienceId.startsWith('seg:teacher:')) {
    const teacherId = Number(audienceId.slice('seg:teacher:'.length));
    if (!Number.isFinite(teacherId)) return [];
    return chatIdsForTelegramIds(admin, await telegramIdsForTeacherStudents(admin, teacherId));
  }
  return [];
}

export async function resolveGroupSegmentTitle(admin: SupabaseClient, groupId: number): Promise<string> {
  const { data } = await admin.from('groups').select('title').eq('id', groupId).maybeSingle();
  return (data?.title as string | undefined)?.trim() || `Группа #${groupId}`;
}

export async function resolveTeacherSegmentTitle(admin: SupabaseClient, teacherId: number): Promise<string> {
  const { data } = await admin.from('bot_members').select('full_name').eq('telegram_id', teacherId).maybeSingle();
  const name = (data?.full_name as string | undefined)?.trim();
  return name || `ID ${teacherId}`;
}
