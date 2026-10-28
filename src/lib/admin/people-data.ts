import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { combineMemberRoles, roleLabel } from '@/lib/bot/roles';
import { adminActionLabel, isActionLogTableError } from '@/lib/bot/admin/action-log';

export const PEOPLE_TAG = 'admin-people';

export type PersonRoleBadge = { role: string; label: string };

export type AdminPersonListRow = {
  telegramId: number;
  name: string;
  phone: string | null;
  telegramLinked: boolean;
  /** Основная роль + дополнительные (mentor → curator). */
  roles: PersonRoleBadge[];
  activity: { whenLabel: string; note: string } | null;
};

const MEMBER_COLUMNS = 'telegram_id, role, phone, full_name, chat_id, updated_at, extra_roles';

export function roleBadges(role: string, extra: string[] | null | undefined): PersonRoleBadge[] {
  const seen = new Set<string>();
  const out: PersonRoleBadge[] = [];
  for (const r of combineMemberRoles(role, extra ?? [])) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push({ role: r, label: roleLabel(r) });
  }
  return out;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const msk = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const time = d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const day = msk(d);
  if (day === msk(new Date())) return `Сегодня, ${time}`;
  if (day === msk(new Date(Date.now() - 86400000))) return `Вчера, ${time}`;
  return `${d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })}, ${time}`;
}

const cleanAction = (action: string) => adminActionLabel(action).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');

/**
 * Все люди одним запросом (фильтры, поиск и страницы — на клиенте).
 * Кэш 30 с; сбрасывается при смене роли.
 */
export const listAdminPeopleCached = unstable_cache(
  async (): Promise<AdminPersonListRow[]> => {
    const admin = createAdminClient();
    const [membersRes, logsRes] = await Promise.all([
      admin.from('bot_members').select(MEMBER_COLUMNS).order('created_at', { ascending: false }).limit(3000),
      admin
        .from('admin_action_log')
        .select('target_telegram_id, action, created_at')
        .not('target_telegram_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1500),
    ]);
    if (membersRes.error) throw membersRes.error;

    const activityBy = new Map<number, { whenLabel: string; note: string }>();
    if (!logsRes.error || !isActionLogTableError(logsRes.error)) {
      for (const row of logsRes.data ?? []) {
        const tg = row.target_telegram_id as number;
        if (activityBy.has(tg)) continue;
        activityBy.set(tg, { whenLabel: formatWhen(row.created_at as string), note: cleanAction(row.action as string) });
      }
    }

    return (membersRes.data ?? []).map((m) => {
      const tg = m.telegram_id as number;
      const updated = m.updated_at as string | null;
      return {
        telegramId: tg,
        name: (m.full_name as string | null)?.trim() || `ID ${tg}`,
        phone: (m.phone as string | null) ?? null,
        telegramLinked: Boolean(m.chat_id),
        roles: roleBadges(String(m.role ?? 'guest'), m.extra_roles as string[] | null),
        activity:
          activityBy.get(tg) ?? (updated ? { whenLabel: formatWhen(updated), note: 'Профиль обновлён' } : null),
      };
    });
  },
  ['admin-people-list'],
  { revalidate: 30, tags: [PEOPLE_TAG] },
);

/** Поля из student_profiles (личный кабинет ученика). */
export type AdminPersonCabinetProfile = {
  displayName: string | null;
  schoolClass: string | null;
  goal: string | null;
  resultType: 'ct' | 'grade' | null;
  resultValue: number | null;
};

export type AdminPersonDetail = {
  telegramId: number;
  /** Для шапки: имя из кабинета или full_name из bot_members. */
  name: string;
  /** full_name в bot_members (Telegram). */
  memberFullName: string;
  phone: string | null;
  registeredAt: string | null;
  cabinetProfile: AdminPersonCabinetProfile | null;
  primaryRole: string;
  extraRoles: string[];
  roles: PersonRoleBadge[];
  courses: Array<{ courseId: number; title: string; startedAt: string | null }>;
  packages: Array<{
    id: number;
    title: string;
    remaining: number | null;
    total: number | null;
    status: string;
  }>;
  recentActions: Array<{ id: string; whenLabel: string; title: string }>;
};

function parseCabinetProfileRow(row: Record<string, unknown> | null): AdminPersonCabinetProfile | null {
  if (!row) return null;
  const resultTypeRaw = row.result_type as string | null | undefined;
  const resultType =
    resultTypeRaw === 'ct' || resultTypeRaw === 'grade' ? resultTypeRaw : null;
  const resultValue =
    typeof row.result_value === 'number' && Number.isFinite(row.result_value)
      ? row.result_value
      : null;
  return {
    displayName: (row.display_name as string | null)?.trim() || null,
    schoolClass: (row.school_class as string | null)?.trim() || null,
    goal: (row.goal as string | null)?.trim() || null,
    resultType,
    resultValue,
  };
}

export function formatCabinetProfileResult(profile: AdminPersonCabinetProfile | null): string {
  if (!profile || profile.resultValue === null) return '—';
  if (profile.resultType === 'grade') return `Оценка ${profile.resultValue} / 10`;
  if (profile.resultType === 'ct') return `${profile.resultValue} баллов РТ`;
  return String(profile.resultValue);
}

export function cabinetProfileFilled(profile: AdminPersonCabinetProfile | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.displayName ||
      profile.schoolClass ||
      profile.goal ||
      profile.resultValue !== null,
  );
}

export const loadAdminPersonDetailCached = unstable_cache(
  async (telegramId: number): Promise<AdminPersonDetail | null> => {
    const admin = createAdminClient();
    const [memberRes, linkRes, profileRes, coursesRes, packagesRes, logsRes] = await Promise.all([
      admin
        .from('bot_members')
        .select('telegram_id, role, phone, full_name, created_at, extra_roles')
        .eq('telegram_id', telegramId)
        .maybeSingle(),
      admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
      admin
        .from('student_profiles')
        .select('display_name, school_class, goal, result_type, result_value')
        .eq('telegram_id', telegramId)
        .maybeSingle(),
      admin
        .from('course_enrollments')
        .select('course_id, started_at, courses(title)')
        .eq('telegram_id', telegramId)
        .eq('status', 'active')
        .order('started_at', { ascending: false }),
      admin
        .from('lesson_packages')
        .select('id, product, title, total_lessons, remaining_lessons, status')
        .eq('telegram_id', telegramId)
        .order('id', { ascending: false })
        .limit(30),
      admin
        .from('admin_action_log')
        .select('id, action, created_at')
        .eq('target_telegram_id', telegramId)
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    const m = memberRes.data;
    if (!m) return null;

    const extra = Array.isArray(m.extra_roles) ? (m.extra_roles as string[]) : [];
    const roles = roleBadges(String(m.role ?? 'guest'), extra);
    const primary = roles[0]?.role ?? 'guest';

    const productLabel = (p: string) => (p === 'individual' ? 'Индивидуальные' : p === 'group' ? 'Группа' : p === 'course' ? 'Курс' : p);

    let cabinetProfile: AdminPersonCabinetProfile | null = null;
    if (!profileRes.error) {
      cabinetProfile = parseCabinetProfileRow(profileRes.data as Record<string, unknown> | null);
    } else {
      const msg = String(profileRes.error.message ?? '');
      if (!msg.includes('student_profiles') && !msg.includes('does not exist')) {
        throw profileRes.error;
      }
    }

    const memberName = (m.full_name as string | null)?.trim() || `ID ${telegramId}`;
    const displayFromCabinet = cabinetProfile?.displayName;

    return {
      telegramId,
      name: displayFromCabinet || memberName,
      memberFullName: memberName,
      phone: (linkRes.data?.phone as string | null) ?? (m.phone as string | null) ?? null,
      registeredAt: (m.created_at as string | null) ?? null,
      cabinetProfile,
      primaryRole: primary,
      extraRoles: roles.slice(1).map((r) => r.role),
      roles,
      courses: (coursesRes.data ?? []).map((row) => {
        const course = (row as unknown as { courses: { title?: string } | null }).courses;
        return {
          courseId: row.course_id as number,
          title: course?.title?.trim() || `Курс ${row.course_id}`,
          startedAt: (row.started_at as string | null) ?? null,
        };
      }),
      packages: (packagesRes.data ?? []).map((p) => ({
        id: p.id as number,
        title: (p.title as string | null)?.trim() || productLabel(String(p.product ?? '')),
        remaining: (p.remaining_lessons as number | null) ?? null,
        total: (p.total_lessons as number | null) ?? null,
        status: String(p.status ?? ''),
      })),
      recentActions:
        logsRes.error && isActionLogTableError(logsRes.error)
          ? []
          : (logsRes.data ?? []).map((r) => ({
              id: String(r.id),
              whenLabel: formatWhen(r.created_at as string),
              title: cleanAction(r.action as string),
            })),
    };
  },
  ['admin-person-detail'],
  { revalidate: 30, tags: [PEOPLE_TAG] },
);
