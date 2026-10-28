import { unstable_cache } from 'next/cache';
import { memberCanActAsKind, memberRolesSummary } from '@/lib/bot/admin/staff-roster';
import { combineMemberRoles, memberHasRole } from '@/lib/bot/roles';
import type { AdminCabinetContext } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export type AdminScheduleTeacherOption = {
  telegramId: number;
  fullName: string | null;
  rolesLine: string;
};

/** Преподаватели (role или extra_roles = teacher), без людей с ролью admin. */
export async function loadAdminScheduleTeachers(
  ctx: AdminCabinetContext,
): Promise<AdminScheduleTeacherOption[]> {
  let rows: Array<{ telegram_id: number; full_name: string | null; role: string; extra_roles: string[] | null }> = [];
  const filtered = await ctx.admin
    .from('bot_members')
    .select('telegram_id, full_name, role, extra_roles')
    .or('role.eq.teacher,extra_roles.cs.{teacher}')
    .limit(500);
  if (!filtered.error) {
    rows = (filtered.data ?? []) as typeof rows;
  } else {
    const all = await ctx.admin
      .from('bot_members')
      .select('telegram_id, full_name, role, extra_roles')
      .limit(2000);
    if (all.error) throw all.error;
    rows = (all.data ?? []) as typeof rows;
  }

  return rows
    .filter((row) => {
      const roles = combineMemberRoles(row.role, row.extra_roles ?? []);
      return memberHasRole(roles, 'teacher') && !memberHasRole(roles, 'admin');
    })
    .map((row) => ({
      telegramId: row.telegram_id,
      fullName: row.full_name,
      rolesLine: memberRolesSummary(row.role, row.extra_roles ?? []),
    }))
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? '', 'ru'));
}

export async function adminActorIsTeacher(ctx: AdminCabinetContext): Promise<boolean> {
  return memberCanActAsKind(ctx.admin, ctx.telegramId, 'teacher');
}

export type AdminTeacherRow = AdminScheduleTeacherOption & {
  isSelf: boolean;
  lessonsToday: number;
  lessonsWeek: number;
  nextLessonLabel: string | null;
};

const MSK_OFFSET_MS = 3 * 3600000;

function mskDayStartMs(now: number): number {
  const day = 86400000;
  return Math.floor((now + MSK_OFFSET_MS) / day) * day - MSK_OFFSET_MS;
}

function formatNext(iso: string, now: number): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const dayStart = mskDayStartMs(now);
  const startMs = d.getTime();
  if (startMs < dayStart + 86400000) return `Сегодня, ${time}`;
  if (startMs < dayStart + 2 * 86400000) return `Завтра, ${time}`;
  const date = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
  return `${date}, ${time}`;
}

/** Список преподавателей со сводкой занятий (один запрос на все занятия окна). */
async function loadAdminTeacherRowsUncached(ctx: AdminCabinetContext): Promise<AdminTeacherRow[]> {
  const teachers = await loadAdminScheduleTeachers(ctx);
  if (teachers.length === 0) return [];

  const now = Date.now();
  const dayStart = mskDayStartMs(now);
  const weekEnd = dayStart + 7 * 86400000;

  const { data } = await ctx.admin
    .from('scheduled_lessons')
    .select('teacher_telegram_id, starts_at')
    .in('teacher_telegram_id', teachers.map((t) => t.telegramId))
    .eq('status', 'scheduled')
    .gte('starts_at', new Date(dayStart).toISOString())
    .lt('starts_at', new Date(weekEnd).toISOString())
    .order('starts_at', { ascending: true })
    .limit(2000);

  const todayEnd = dayStart + 86400000;
  const stats = new Map<number, { today: number; week: number; next: string | null }>();
  for (const row of data ?? []) {
    const tg = row.teacher_telegram_id as number;
    const startsAt = row.starts_at as string;
    const ms = new Date(startsAt).getTime();
    const s = stats.get(tg) ?? { today: 0, week: 0, next: null };
    s.week += 1;
    if (ms < todayEnd) s.today += 1;
    if (!s.next && ms >= now) s.next = startsAt;
    stats.set(tg, s);
  }

  return teachers
    .map((t) => {
      const s = stats.get(t.telegramId);
      return {
        ...t,
        isSelf: t.telegramId === ctx.telegramId,
        lessonsToday: s?.today ?? 0,
        lessonsWeek: s?.week ?? 0,
        nextLessonLabel: s?.next ? formatNext(s.next, now) : null,
      };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || (a.fullName ?? '').localeCompare(b.fullName ?? '', 'ru'));
}

const loadAdminTeacherRowsCached = unstable_cache(
  async (selfTelegramId: number) => {
    const admin = createAdminClient();
    return loadAdminTeacherRowsUncached({ admin, telegramId: selfTelegramId, phone: '', displayName: null });
  },
  ['admin-schedule-teacher-rows'],
  { revalidate: 35, tags: ['admin-schedule'] },
);

export async function loadAdminTeacherRows(ctx: AdminCabinetContext): Promise<AdminTeacherRow[]> {
  return loadAdminTeacherRowsCached(ctx.telegramId);
}
