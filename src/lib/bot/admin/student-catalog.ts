import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudentTeacher } from '@/lib/bot/education/assignments';
import { getStudentGroups } from '@/lib/bot/education/groups';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  USERS_PER_PAGE,
  editAdminMessage,
  editDeliver,
  homeButton,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import type { MemberRow } from '@/lib/bot/roles';
import { listMembersInRoles, getMember } from '@/lib/bot/roles';

export type StudentFilterId =
  | 'all'
  | 'active'
  | 'low_pkg'
  | 'individual'
  | 'course'
  | 'group';

const FILTER_LABELS: Record<StudentFilterId, string> = {
  all: 'Все ученики',
  active: 'Активные',
  low_pkg: 'Пакет ≤2',
  individual: 'Индивидуальные',
  course: 'С курсом',
  group: 'Групповые',
};

export async function renderStudentsHub(deliver: Deliver): Promise<void> {
  const keyboard: InlineButton[][] = [
    [{ text: '📋 Все', callback_data: 'ah:stu:f:all:0' }],
    [{ text: '🟢 Активные', callback_data: 'ah:stu:f:active:0' }],
    [{ text: '📦 Пакет заканчивается', callback_data: 'ah:stu:f:low_pkg:0' }],
    [{ text: '👤 Индивидуальные', callback_data: 'ah:stu:f:individual:0' }],
    [{ text: '🎓 Онлайн-курс', callback_data: 'ah:stu:f:course:0' }],
    [{ text: '👥 В группах', callback_data: 'ah:stu:f:group:0' }],
    [{ text: '👨‍🏫 По преподавателю', callback_data: 'ah:stu:pick:teacher:0' }],
    [{ text: '⬅️ Люди', callback_data: 'ah:people' }],
    [homeButton()],
  ];
  await deliver('👨‍🎓 Ученики\n\nВыбери фильтр. В списке — формат, преподаватель, пакет, ближайшее занятие.', {
    inline_keyboard: keyboard,
  });
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

async function idsLowPackage(admin: SupabaseClient): Promise<number[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('telegram_id')
    .eq('status', 'active')
    .lte('remaining_lessons', 2);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.telegram_id as number))];
}

async function idsWithAccessProduct(admin: SupabaseClient, product: string): Promise<Set<number>> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('telegram_id')
    .eq('status', 'active')
    .eq('product', product);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.telegram_id as number));
}

async function idsInGroups(admin: SupabaseClient): Promise<Set<number>> {
  const { data, error } = await admin.from('group_members').select('telegram_id').eq('status', 'active');
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.telegram_id as number));
}

async function resolveStudentIds(admin: SupabaseClient, filter: StudentFilterId): Promise<number[] | null> {
  if (filter === 'all') return null;
  if (filter === 'active') return [...(await idsWithActiveProduct(admin))];
  if (filter === 'low_pkg') return idsLowPackage(admin);
  if (filter === 'individual') return [...(await idsWithAccessProduct(admin, 'individual'))];
  if (filter === 'course') return [...(await idsWithAccessProduct(admin, 'course'))];
  if (filter === 'group') return [...(await idsInGroups(admin))];
  return null;
}

async function enrichStudentSummary(admin: SupabaseClient, telegramId: number): Promise<string> {
  const parts: string[] = [];
  const [{ data: accesses }, { data: pkg }, teacher, groups] = await Promise.all([
    admin.from('user_accesses').select('product').eq('telegram_id', telegramId).eq('status', 'active'),
    admin
      .from('lesson_packages')
      .select('remaining_lessons, product')
      .eq('telegram_id', telegramId)
      .eq('status', 'active')
      .order('id', { ascending: false })
      .limit(1),
    getStudentTeacher(admin, telegramId),
    getStudentGroups(admin, telegramId),
  ]);

  const format: string[] = [];
  for (const a of accesses ?? []) {
    const p = a.product as string;
    if (p === 'course') format.push('курс');
    if (p === 'individual') format.push('ind');
    if (p === 'group') format.push('группа');
  }
  if (groups.length > 0 && !format.includes('группа')) format.push('группа');
  parts.push(format.length ? format.join('+') : '—');

  if (teacher?.fullName) parts.push(`👨‍🏫 ${shorten(teacher.fullName, 12)}`);
  else if (teacher) parts.push(`👨‍🏫 ID${teacher.telegramId}`);

  const rem = pkg?.[0]?.remaining_lessons;
  if (typeof rem === 'number') parts.push(`📦 ${rem}`);

  const now = new Date().toISOString();
  const { data: nextLesson } = await admin
    .from('scheduled_lessons')
    .select('starts_at')
    .eq('telegram_id', telegramId)
    .gte('starts_at', now)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextLesson?.starts_at) {
    const d = new Date(nextLesson.starts_at as string);
    parts.push(
      `📅 ${d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    );
  }

  return parts.join(' · ');
}

async function loadStudentPageMembers(
  admin: SupabaseClient,
  filter: StudentFilterId,
  teacherId: number | null,
  page: number,
): Promise<{ members: MemberRow[]; total: number }> {
  if (teacherId) {
    const { data, error } = await admin
      .from('mentor_assignments')
      .select('telegram_id')
      .eq('mentor_telegram_id', teacherId)
      .eq('kind', 'teacher')
      .eq('status', 'active');
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((r) => r.telegram_id as number))];
    const members: MemberRow[] = [];
    for (const id of ids) {
      const m = await getMember(admin, id);
      if (m) members.push(m);
    }
    members.sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), 'ru'));
    const from = page * USERS_PER_PAGE;
    return { members: members.slice(from, from + USERS_PER_PAGE), total: members.length };
  }

  const idFilter = await resolveStudentIds(admin, filter);
  if (idFilter && idFilter.length === 0) {
    return { members: [], total: 0 };
  }

  if (idFilter) {
    const members: MemberRow[] = [];
    for (const id of idFilter) {
      const m = await getMember(admin, id);
      if (m && m.role === 'student') members.push(m);
    }
    members.sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), 'ru'));
    const from = page * USERS_PER_PAGE;
    return { members: members.slice(from, from + USERS_PER_PAGE), total: members.length };
  }

  return listMembersInRoles(admin, ['student'], page, USERS_PER_PAGE);
}

export async function renderStudentFilterList(
  admin: SupabaseClient,
  message: AdminMessage,
  filter: StudentFilterId,
  page: number,
  teacherId: number | null = null,
): Promise<void> {
  const { members, total } = await loadStudentPageMembers(admin, filter, teacherId, page);
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const title = teacherId
    ? `👨‍🏫 Ученики преподавателя #${teacherId}`
    : `👨‍🎓 ${FILTER_LABELS[filter]}`;

  const lines: string[] = [title, ''];
  const summaries = await Promise.all(members.map((m) => enrichStudentSummary(admin, m.telegram_id)));

  for (let i = 0; i < members.length; i++) {
    lines.push(`${safePage * USERS_PER_PAGE + i + 1}. ${memberDisplayName(members[i])}`);
    lines.push(`   ${summaries[i]}`);
    lines.push('');
  }
  if (members.length === 0) lines.push('Никого не найдено.');

  const keyboard: InlineButton[][] = members.map((member, i) => [
    {
      text: shorten(`${memberDisplayName(member)} — ${summaries[i]}`, 58),
      callback_data: `admin:user:${member.telegram_id}::`,
    },
  ]);

  if (pageCount > 1) {
    const cb =
      teacherId != null
        ? (p: number) => `ah:stu:by:${teacherId}:${p}`
        : (p: number) => `ah:stu:f:${filter}:${p}`;
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? cb(safePage - 1) : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? cb(safePage + 1) : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Фильтры', callback_data: 'ah:stu:menu' }], [homeButton()]);

  await editAdminMessage(message, lines.join('\n').slice(0, 3900), { inline_keyboard: keyboard });
}

export async function renderTeacherPickerForStudents(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const { members, total } = await listMembersInRoles(
    admin,
    ['teacher', 'mentor'],
    page,
    USERS_PER_PAGE,
  );
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const keyboard: InlineButton[][] = members.map((m) => [
    {
      text: memberDisplayName(m),
      callback_data: `ah:stu:by:${m.telegram_id}:0`,
    },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:stu:pick:teacher:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:stu:pick:teacher:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Ученики', callback_data: 'ah:stu:menu' }], [homeButton()]);

  await editAdminMessage(message, '👨‍🏫 Выбери преподавателя', { inline_keyboard: keyboard });
}
