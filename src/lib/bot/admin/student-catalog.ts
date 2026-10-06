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
  | 'paused'
  | 'new'
  | 'low_pkg'
  | 'individual'
  | 'course'
  | 'group';

const FILTER_LABELS: Record<StudentFilterId, string> = {
  all: 'Все ученики',
  active: 'Активные',
  paused: 'На паузе',
  new: 'Новые',
  low_pkg: 'Пакет заканчивается',
  individual: 'Индивидуальные',
  course: 'С курсом',
  group: 'Групповые',
};

async function countStudentsSummary(admin: SupabaseClient): Promise<{
  total: number;
  active: number;
  paused: number;
  newCount: number;
}> {
  const { total } = await listMembersInRoles(admin, ['student'], 0, 1);
  const activeIds = await idsWithActiveProduct(admin);
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: studentRows } = await admin.from('bot_members').select('telegram_id, created_at').eq('role', 'student');
  let newCount = 0;
  let active = 0;
  for (const row of studentRows ?? []) {
    const id = row.telegram_id as number;
    if (activeIds.has(id)) active += 1;
    if (String(row.created_at) >= since7d) newCount += 1;
  }
  const totalN = studentRows?.length ?? total;
  const paused = Math.max(0, totalN - active);
  return { total: totalN, active, paused, newCount };
}

export async function renderStudentsHub(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const c = await countStudentsSummary(admin);
  const text = [
    '👨‍🎓 Ученики',
    '',
    `Всего: ${c.total}`,
    `Активных: ${c.active}`,
    `На паузе: ${c.paused}`,
    `Новых: ${c.newCount}`,
  ].join('\n');

  const keyboard: InlineButton[][] = [
    [
      { text: 'Все', callback_data: 'ah:stu:f:all:0' },
      { text: 'Активные', callback_data: 'ah:stu:f:active:0' },
      { text: 'Пауза', callback_data: 'ah:stu:f:paused:0' },
      { text: 'Новые', callback_data: 'ah:stu:f:new:0' },
    ],
    [{ text: '⚙️ Фильтры', callback_data: 'ah:stu:adv' }],
    [{ text: '⬅️ Люди', callback_data: 'ah:people' }],
    [homeButton()],
  ];
  await deliver(text, { inline_keyboard: keyboard });
}

export async function renderStudentsAdvancedFilters(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  void admin;
  const keyboard: InlineButton[][] = [
    [{ text: '👤 Индивидуальные', callback_data: 'ah:stu:f:individual:0' }],
    [{ text: '👥 Групповые', callback_data: 'ah:stu:f:group:0' }],
    [{ text: '🎓 Онлайн-курс', callback_data: 'ah:stu:f:course:0' }],
    [{ text: '📦 Заканчивается пакет', callback_data: 'ah:stu:f:low_pkg:0' }],
    [{ text: '👨‍🏫 По преподавателю', callback_data: 'ah:stu:pick:teacher:0' }],
    [{ text: '⬅️ Ученики', callback_data: 'ah:stu:menu' }],
    [homeButton()],
  ];
  await editAdminMessage(message, '⚙️ Фильтры учеников\n\nДополнительные условия отбора.', {
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

async function idsNewStudents(admin: SupabaseClient): Promise<number[]> {
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id')
    .eq('role', 'student')
    .gte('created_at', since7d);
  if (error) return [];
  return (data ?? []).map((r) => r.telegram_id as number);
}

async function idsPausedStudents(admin: SupabaseClient): Promise<number[]> {
  const active = await idsWithActiveProduct(admin);
  const { data, error } = await admin.from('bot_members').select('telegram_id').eq('role', 'student');
  if (error) return [];
  return (data ?? [])
    .map((r) => r.telegram_id as number)
    .filter((id) => !active.has(id));
}

async function resolveStudentIds(admin: SupabaseClient, filter: StudentFilterId): Promise<number[] | null> {
  if (filter === 'all') return null;
  if (filter === 'active') return [...(await idsWithActiveProduct(admin))];
  if (filter === 'paused') return idsPausedStudents(admin);
  if (filter === 'new') return idsNewStudents(admin);
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

  const activeIds = await idsWithActiveProduct(admin);
  const statuses = members.map((m) => (activeIds.has(m.telegram_id) ? '🟢 Активен' : '⏸️ Пауза'));

  for (let i = 0; i < members.length; i++) {
    lines.push(`👨‍🎓 ${memberDisplayName(members[i])}`);
    lines.push(summaries[i]);
    lines.push(statuses[i]);
    lines.push('');
  }
  if (members.length === 0) lines.push('Никого не найдено.');

  const navBack =
    filter === 'individual' ||
    filter === 'course' ||
    filter === 'group' ||
    filter === 'low_pkg' ||
    teacherId != null
      ? 'ah:stu:adv'
      : 'ah:stu:menu';

  const keyboard: InlineButton[][] = members.map((member, i) => [
    {
      text: shorten(`${memberDisplayName(member)} — ${summaries[i]}`, 58),
      callback_data: `admin:user:${member.telegram_id}::stu:${filter}:${safePage}`,
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
  keyboard.push([{ text: '⬅️ Назад', callback_data: navBack }], [homeButton()]);

  await editAdminMessage(message, lines.join('\n').slice(0, 3900), { inline_keyboard: keyboard });
}

export async function renderTeacherPickerForStudents(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const { listMentorPickerCandidates } = await import('./staff-roster');
  const all = await listMentorPickerCandidates(admin, 'teacher');
  const pageCount = Math.max(1, Math.ceil(all.length / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = all.slice(safePage * USERS_PER_PAGE, safePage * USERS_PER_PAGE + USERS_PER_PAGE);

  const keyboard: InlineButton[][] = slice.map((m) => [
    {
      text: shorten(`${m.full_name ?? `ID ${m.telegram_id}`} · ${m.rolesLine}`, 58),
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
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'ah:stu:adv' }], [homeButton()]);

  await editAdminMessage(message, '👨‍🏫 Выбери преподавателя', { inline_keyboard: keyboard });
}
