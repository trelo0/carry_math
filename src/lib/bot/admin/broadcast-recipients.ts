import type { SupabaseClient } from '@supabase/supabase-js';
import { getBroadcastSegmentRecipients } from './broadcast-segments';
import type { StudentFilterId } from './student-catalog';

const STAFF_ROLES = ['teacher', 'curator', 'mentor', 'admin'];

async function chatIdsFromTelegramIds(admin: SupabaseClient, telegramIds: number[]): Promise<number[]> {
  const unique = [...new Set(telegramIds)];
  if (unique.length === 0) return [];
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

async function idsWithActiveProduct(admin: SupabaseClient): Promise<Set<number>> {
  const ids = new Set<number>();
  const [{ data: acc }, { data: pkg }] = await Promise.all([
    admin.from('user_accesses').select('telegram_id').eq('status', 'active'),
    admin.from('lesson_packages').select('telegram_id').eq('status', 'active'),
  ]);
  for (const row of acc ?? []) ids.add(row.telegram_id as number);
  for (const row of pkg ?? []) ids.add(row.telegram_id as number);
  return ids;
}

async function resolveStudentFilterIds(admin: SupabaseClient, filter: StudentFilterId): Promise<number[]> {
  if (filter === 'all') {
    const { data } = await admin.from('bot_members').select('telegram_id').eq('role', 'student');
    return (data ?? []).map((r) => r.telegram_id as number);
  }
  if (filter === 'active') return [...(await idsWithActiveProduct(admin))];
  if (filter === 'paused') {
    const active = await idsWithActiveProduct(admin);
    const { data } = await admin.from('bot_members').select('telegram_id').eq('role', 'student');
    return (data ?? []).map((r) => r.telegram_id as number).filter((id) => !active.has(id));
  }
  if (filter === 'new') {
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await admin
      .from('bot_members')
      .select('telegram_id')
      .eq('role', 'student')
      .gte('created_at', since7d);
    return (data ?? []).map((r) => r.telegram_id as number);
  }
  if (filter === 'low_pkg') {
    const { data } = await admin
      .from('lesson_packages')
      .select('telegram_id')
      .eq('status', 'active')
      .lte('remaining_lessons', 2);
    return [...new Set((data ?? []).map((r) => r.telegram_id as number))];
  }
  if (filter === 'individual' || filter === 'course' || filter === 'group') {
    const product = filter === 'individual' ? 'individual' : filter === 'course' ? 'course' : 'group';
    const { data } = await admin
      .from('user_accesses')
      .select('telegram_id')
      .eq('status', 'active')
      .eq('product', product);
    let ids = new Set((data ?? []).map((r) => r.telegram_id as number));
    if (filter === 'group') {
      const { data: gm } = await admin.from('group_members').select('telegram_id').eq('status', 'active');
      for (const row of gm ?? []) ids.add(row.telegram_id as number);
    }
    return [...ids];
  }
  return [];
}

/** Активные ученики (роль student + активный доступ/пакет). */
export async function telegramIdsActiveStudents(admin: SupabaseClient): Promise<number[]> {
  const active = await idsWithActiveProduct(admin);
  const { data } = await admin.from('bot_members').select('telegram_id').eq('role', 'student');
  return (data ?? []).map((r) => r.telegram_id as number).filter((id) => active.has(id));
}

/** Клиенты школы: ученики и лиды с Telegram, не «все пользователи бота». */
export async function telegramIdsClients(admin: SupabaseClient): Promise<number[]> {
  const ids = new Set<number>();
  const { data: students } = await admin.from('bot_members').select('telegram_id').eq('role', 'student');
  for (const row of students ?? []) ids.add(row.telegram_id as number);

  const { data: leads } = await admin.from('leads').select('telegram_id');
  for (const row of leads ?? []) {
    const tg = row.telegram_id as number | null;
    if (typeof tg === 'number' && tg > 0) ids.add(tg);
  }
  return [...ids];
}

export async function telegramIdsStaff(admin: SupabaseClient): Promise<number[]> {
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id')
    .in('role', STAFF_ROLES);
  if (error) throw error;
  return (data ?? []).map((r) => r.telegram_id as number);
}

export function isBroadcastFilterAudience(audienceId: string): boolean {
  return audienceId.startsWith('seg:filter:');
}

export function filterFromAudienceId(audienceId: string): StudentFilterId | null {
  const raw = audienceId.slice('seg:filter:'.length);
  const allowed: StudentFilterId[] = ['active', 'paused', 'new', 'low_pkg', 'individual', 'course', 'group'];
  return allowed.includes(raw as StudentFilterId) ? (raw as StudentFilterId) : null;
}

export async function countBroadcastRecipients(admin: SupabaseClient, audienceId: string): Promise<number> {
  const chats = await resolveBroadcastRecipientsExtended(admin, audienceId);
  return chats.length;
}

export async function resolveBroadcastRecipientsExtended(
  admin: SupabaseClient,
  audienceId: string,
): Promise<number[]> {
  if (!audienceId) return [];

  if (audienceId === 'aud:students') {
    return chatIdsFromTelegramIds(admin, await telegramIdsActiveStudents(admin));
  }
  if (audienceId === 'aud:clients') {
    return chatIdsFromTelegramIds(admin, await telegramIdsClients(admin));
  }
  if (audienceId === 'aud:staff') {
    return chatIdsFromTelegramIds(admin, await telegramIdsStaff(admin));
  }
  if (isBroadcastFilterAudience(audienceId)) {
    const filter = filterFromAudienceId(audienceId);
    if (!filter) return [];
    return chatIdsFromTelegramIds(admin, await resolveStudentFilterIds(admin, filter));
  }
  if (audienceId.startsWith('seg:')) {
    return getBroadcastSegmentRecipients(admin, audienceId);
  }

  return [];
}

export const SPEC_RECIPIENT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'aud:students', label: '👨‍🎓 Все ученики' },
  { id: 'aud:clients', label: '👤 Все клиенты' },
  { id: 'seg:group:pick', label: '👥 Группа' },
  { id: 'seg:access:course', label: '📚 Курс' },
  { id: 'aud:staff', label: '👨‍💼 Сотрудники' },
  { id: 'admin:bc:filters', label: '🎯 По фильтрам' },
];

export function audienceTitleForId(audienceId: string, extra?: string): string {
  if (audienceId === 'aud:students') return 'Все ученики (активные)';
  if (audienceId === 'aud:clients') return 'Все клиенты';
  if (audienceId === 'aud:staff') return 'Сотрудники';
  if (isBroadcastFilterAudience(audienceId)) {
    const f = filterFromAudienceId(audienceId);
    const labels: Record<string, string> = {
      active: 'Активные',
      paused: 'На паузе',
      new: 'Новые',
      low_pkg: 'Пакет 1–2 занятия',
      individual: 'Индивидуальные',
      course: 'Курс',
      group: 'Групповые',
    };
    return f ? `Фильтр: ${labels[f] ?? f}` : 'Фильтр';
  }
  if (extra) return extra;
  if (audienceId.startsWith('seg:group:')) return extra ?? `Группа #${audienceId.split(':')[2]}`;
  if (audienceId === 'seg:access:course') return 'Курс (активный доступ)';
  return audienceId;
}
