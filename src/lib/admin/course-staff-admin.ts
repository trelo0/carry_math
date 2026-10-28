import { unstable_cache, revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCourseStaffIds } from '@/lib/bot/education/course-staff';
import { combineMemberRoles, roleLabel } from '@/lib/bot/roles';
import { loadCourseDocs, saveCourseDoc, revalidateCourses } from '@/lib/admin/course-docs';
import { syncCourseRowFromSanity } from '@/lib/admin/courses-data';
import { PEOPLE_TAG } from '@/lib/admin/people-data';
import { SettingsDocError, sanityDocsClient } from '@/lib/admin/settings-docs';

export type StaffPerson = { telegramId: number; name: string; roles: string };
export type TeacherOption = { id: string; name: string; subject: string | null };

export type CourseStaffData = {
  rev: string | null;
  teacher: TeacherOption | null;
  curator: StaffPerson | null;
  check: StaffPerson | null;
  teachers: TeacherOption[];
  candidates: StaffPerson[];
};

/** Все участники бота (включая гостей): при назначении получают staff + роль по курсу. Сотрудники — первыми. */
const loadCandidatesCached = unstable_cache(
  async (): Promise<StaffPerson[]> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('bot_members')
      .select('telegram_id, full_name, role, extra_roles')
      .limit(5000);
    if (error) throw error;
    const out: StaffPerson[] = [];
    for (const m of data ?? []) {
      const extra = Array.isArray(m.extra_roles) ? (m.extra_roles as string[]) : [];
      const roles = combineMemberRoles(String(m.role ?? 'guest'), extra);
      out.push({
        telegramId: m.telegram_id as number,
        name: (m.full_name as string | null)?.trim() || `ID ${m.telegram_id}`,
        roles: [...new Set(roles.filter((r) => r !== 'guest'))].map((r) => roleLabel(r)).join(', ') || 'гость',
      });
    }
    const isStaff = (p: StaffPerson) => !/^(гость|ученик)(, (гость|ученик))*$/.test(p.roles);
    return out.sort((a, b) => Number(isStaff(b)) - Number(isStaff(a)) || a.name.localeCompare(b.name, 'ru'));
  },
  ['admin-staff-candidates'],
  { revalidate: 60, tags: ['admin-staff-candidates'] },
);

const loadTeachersCached = unstable_cache(
  async (): Promise<TeacherOption[]> => {
    const rows = await sanityDocsClient('read').fetch<Array<{ _id: string; name?: string; subject?: string }>>(
      '*[_type == "teacher" && !(_id in path("drafts.**"))] | order(name asc){_id, name, subject}',
    );
    return rows.map((r) => ({ id: r._id, name: r.name?.trim() || 'Без имени', subject: r.subject?.trim() || null }));
  },
  ['admin-sanity-teachers'],
  { revalidate: 120, tags: ['admin-sanity-teachers'] },
);

async function personById(admin: SupabaseClient, telegramId: number | null): Promise<StaffPerson | null> {
  if (telegramId == null) return null;
  const { data } = await admin
    .from('bot_members')
    .select('telegram_id, full_name, role, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!data) return { telegramId, name: `ID ${telegramId}`, roles: 'нет в боте' };
  const extra = Array.isArray(data.extra_roles) ? (data.extra_roles as string[]) : [];
  const roles = combineMemberRoles(String(data.role ?? 'guest'), extra);
  return {
    telegramId,
    name: (data.full_name as string | null)?.trim() || `ID ${telegramId}`,
    roles: [...new Set(roles.filter((r) => r !== 'guest'))].map((r) => roleLabel(r)).join(', ') || 'гость',
  };
}

export async function loadCourseStaffData(admin: SupabaseClient, sanityId: string): Promise<CourseStaffData> {
  const [docs, teachers, candidates] = await Promise.all([
    loadCourseDocs([sanityId]),
    loadTeachersCached(),
    loadCandidatesCached(),
  ]);
  const doc = docs.get(sanityId);
  const teacherRef = (doc?.curator as { _ref?: string } | undefined)?._ref ?? null;
  const curatorId = typeof doc?.curatorTelegramId === 'number' ? doc.curatorTelegramId : null;
  const checkId = typeof doc?.checkTelegramId === 'number' ? doc.checkTelegramId : null;
  const [curator, check] = await Promise.all([personById(admin, curatorId), personById(admin, checkId)]);

  return {
    rev: (doc?._rev as string | undefined) ?? null,
    teacher: teachers.find((t) => t.id === teacherRef) ?? (teacherRef ? { id: teacherRef, name: 'Удалённый преподаватель', subject: null } : null),
    curator,
    check,
    teachers,
    candidates,
  };
}

export type SaveStaffInput = {
  courseId: number;
  sanityId: string;
  rev?: string | null;
  /** undefined — не менять; null — снять. */
  teacherId?: string | null;
  curatorTelegramId?: number | null;
  checkTelegramId?: number | null;
};

/** Назначить можно любого участника бота (даже гостя) — он автоматически станет staff. */
async function assertStaffMember(admin: SupabaseClient, telegramId: number): Promise<void> {
  if (!Number.isInteger(telegramId) || telegramId <= 0) throw new SettingsDocError('Некорректный Telegram ID', 422);
  const { data } = await admin.from('bot_members').select('telegram_id').eq('telegram_id', telegramId).maybeSingle();
  if (!data) throw new SettingsDocError(`Пользователь ${telegramId} не найден в боте (ему нужно нажать /start).`, 422);
}
/** Назначения в Sanity (поля курса) + синхронизация с базой (course_staff_assignments). */
export async function saveCourseStaff(
  admin: SupabaseClient,
  input: SaveStaffInput,
): Promise<{ problems: string[]; rev: string | null }> {
  const current = (await loadCourseDocs([input.sanityId])).get(input.sanityId);
  if (!current) throw new SettingsDocError('Курс не найден в Sanity', 404);

  const teacherRef =
    input.teacherId === undefined ? (current.curator as { _ref?: string } | undefined)?._ref ?? null : input.teacherId;
  const curator =
    input.curatorTelegramId === undefined
      ? typeof current.curatorTelegramId === 'number'
        ? current.curatorTelegramId
        : null
      : input.curatorTelegramId;
  const check =
    input.checkTelegramId === undefined
      ? typeof current.checkTelegramId === 'number'
        ? current.checkTelegramId
        : null
      : input.checkTelegramId;

  if (input.teacherId) {
    const teachers = await loadTeachersCached();
    if (!teachers.some((t) => t.id === input.teacherId)) {
      throw new SettingsDocError('Преподаватель не найден в Sanity', 422);
    }
  }
  if (input.curatorTelegramId != null) await assertStaffMember(admin, input.curatorTelegramId);
  if (input.checkTelegramId != null) await assertStaffMember(admin, input.checkTelegramId);

  const saved = await saveCourseDoc({
    scope: 'staff',
    id: input.sanityId,
    rev: input.rev,
    values: {
      ...(teacherRef ? { curator: { _type: 'reference', _ref: teacherRef } } : {}),
      ...(curator != null ? { curatorTelegramId: curator } : {}),
      ...(check != null ? { checkTelegramId: check } : {}),
    },
  });

  const problems = await syncCourseStaffIds(admin, input.courseId, { curator, check }, `курс #${input.courseId}`, { promote: true });
  await syncCourseRowFromSanity(admin, saved);
  revalidateTag('admin-staff-candidates', { expire: 0 });
  revalidateTag(PEOPLE_TAG, { expire: 0 });
  revalidateCourses();
  return { problems, rev: (saved._rev as string | undefined) ?? null };
}
