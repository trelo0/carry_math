import { revalidateTag, unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishedId } from '@/lib/admin/settings-docs';
import type { SanityDocValues } from '@/lib/admin/sanity-form-types';
import {
  listDistrictCourseSummaries,
  type DistrictCourseSummary,
} from '@/lib/studio/courseContent';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { getCourse } from '@/lib/bot/education/courses';
import { loadCuratorCourseStudents } from '@/lib/curator/students';
import { courseAccess, type AdminCourseAccessTone, type CourseAccess } from '@/lib/admin/course-access';
import type { CourseStaffRole } from '@/lib/bot/education/course-staff';

export type AdminCoursePerson = { telegramId: number; name: string };

export type { AdminCourseAccessTone };

export type AdminCourseListItem = {
  courseId: number;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string | null;
  publicationStatus: 'draft' | 'published' | 'archived';
  accessLabel: string;
  accessHint: string;
  accessTone: AdminCourseAccessTone;
  moduleCount: number;
  lessonCount: number;
  activeStudents: number;
  teachers: AdminCoursePerson[];
  checkers: AdminCoursePerson[];
  isActiveDb: boolean;
};

function accessInfo(summary: DistrictCourseSummary): CourseAccess {
  return courseAccess(summary);
}

const listDistrictSummariesForAdmin = unstable_cache(
  async () => listDistrictCourseSummaries().catch(() => []),
  ['admin-district-course-summaries'],
  { revalidate: 60, tags: ['admin-panel-course-list', 'sanity:course-content'] },
);

/** Курс есть в Sanity, но нет в базе — создаём строку (по slug, без дублей). */
async function linkMissingCourseRows(
  admin: SupabaseClient,
  summaries: DistrictCourseSummary[],
  idBySlug: Map<string, number>,
): Promise<void> {
  for (const s of summaries) {
    if (idBySlug.has(s.slug)) continue;
    const { data, error } = await admin
      .from('courses')
      .insert({
        title: s.title,
        slug: s.slug,
        description: s.description ?? null,
        sanity_id: s.sanityId,
        is_active: s.publicationStatus !== 'archived',
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (!error && data) {
      idBySlug.set(s.slug, data.id as number);
      continue;
    }
    const { data: again } = await admin.from('courses').select('id').eq('slug', s.slug).maybeSingle();
    if (again) idBySlug.set(s.slug, again.id as number);
  }
}

async function fetchAdminCourseListUncached(
  admin: SupabaseClient,
): Promise<AdminCourseListItem[]> {
  const summaries = await listDistrictSummariesForAdmin();
  if (summaries.length === 0) return [];

  const idBySlug = await lookupCourseIdsBySlugs(
    admin,
    summaries.map((s) => s.slug),
  );
  await linkMissingCourseRows(admin, summaries, idBySlug);

  const rows = summaries
    .map((summary) => ({ summary, courseId: idBySlug.get(summary.slug) ?? null }))
    .filter((row): row is { summary: DistrictCourseSummary; courseId: number } => row.courseId != null);

  if (rows.length === 0) return [];

  const courseIds = rows.map((r) => r.courseId);

  const [enrollmentRows, staffRows, courseRows] = await Promise.all([
    admin
      .from('course_enrollments')
      .select('course_id')
      .in('course_id', courseIds)
      .eq('status', 'active'),
    admin
      .from('course_staff_assignments')
      .select('course_id, staff_telegram_id, role')
      .in('course_id', courseIds)
      .eq('status', 'active'),
    admin.from('courses').select('id, is_active').in('id', courseIds),
  ]);

  const studentsByCourse = new Map<number, number>();
  for (const row of enrollmentRows.data ?? []) {
    const id = row.course_id as number;
    studentsByCourse.set(id, (studentsByCourse.get(id) ?? 0) + 1);
  }

  const staffByCourse = new Map<number, Record<'teachers' | 'checkers', Set<number>>>();
  for (const row of staffRows.data ?? []) {
    const courseId = row.course_id as number;
    const role = row.role as CourseStaffRole;
    const tg = row.staff_telegram_id as number;
    const bucket = staffByCourse.get(courseId) ?? { teachers: new Set<number>(), checkers: new Set<number>() };
    (role === 'check' ? bucket.checkers : bucket.teachers).add(tg);
    staffByCourse.set(courseId, bucket);
  }

  const resolveStaff = (courseId: number, summary: DistrictCourseSummary) => {
    const bucket = staffByCourse.get(courseId);
    const teachers = new Set(bucket?.teachers ?? []);
    const checkers = new Set(bucket?.checkers ?? []);
    if (teachers.size === 0 && summary.curatorTelegramId != null) teachers.add(summary.curatorTelegramId);
    if (checkers.size === 0 && summary.checkTelegramId != null) checkers.add(summary.checkTelegramId);
    return { teachers: [...teachers], checkers: [...checkers] };
  };

  const activeByCourse = new Map<number, boolean>();
  for (const row of courseRows.data ?? []) {
    activeByCourse.set(row.id as number, row.is_active !== false);
  }

  const telegramIds = new Set<number>();
  for (const { summary, courseId } of rows) {
    const staff = resolveStaff(courseId, summary);
    staff.teachers.forEach((id) => telegramIds.add(id));
    staff.checkers.forEach((id) => telegramIds.add(id));
  }

  const nameByTg = new Map<number, string>();
  if (telegramIds.size > 0) {
    const { data: members } = await admin
      .from('bot_members')
      .select('telegram_id, full_name, role, phone')
      .in('telegram_id', [...telegramIds]);
    for (const m of members ?? []) {
      const tg = m.telegram_id as number;
      const name = (m.full_name as string | null)?.trim();
      nameByTg.set(tg, name && name.length > 0 ? name : `ID ${tg}`);
    }
  }

  const person = (telegramId: number): AdminCoursePerson => ({
    telegramId,
    name: nameByTg.get(telegramId) ?? `ID ${telegramId}`,
  });

  const items: AdminCourseListItem[] = rows.map(({ summary, courseId }) => {
    const staff = resolveStaff(courseId, summary);
    const access = accessInfo(summary);

    return {
      courseId,
      slug: summary.slug,
      title: summary.title,
      subtitle: summary.cabinetEyebrow ?? summary.deliveryFormat ?? null,
      coverImageUrl: summary.previewImageUrl ?? summary.coverImageUrl ?? null,
      publicationStatus: summary.publicationStatus,
      accessLabel: access.label,
      accessHint: access.hint,
      accessTone: access.tone,
      moduleCount: summary.moduleCount,
      lessonCount: summary.totalLessons,
      activeStudents: studentsByCourse.get(courseId) ?? 0,
      teachers: staff.teachers.map(person),
      checkers: staff.checkers.map(person),
      isActiveDb: activeByCourse.get(courseId) ?? true,
    };
  });

  return items.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

const getAdminCourseListCached = unstable_cache(
  async () => {
    const admin = createAdminClient();
    return fetchAdminCourseListUncached(admin);
  },
  ['admin-panel-course-list'],
  { revalidate: 45, tags: ['admin-panel-course-list'] },
);

/** Список курсов для панели (батч-запросы + короткий server cache). */
export async function fetchAdminCourseList(_admin: SupabaseClient): Promise<AdminCourseListItem[]> {
  return getAdminCourseListCached();
}

/** После сохранения districtCourse в Sanity — подтянуть title/description в Postgres. */
export async function syncCourseRowFromSanity(
  admin: SupabaseClient,
  doc: SanityDocValues,
): Promise<void> {
  const sanityId = publishedId(String(doc._id ?? ''));
  if (!sanityId || doc._type !== 'districtCourse') return;

  const patch: { updated_at: string; title?: string; description?: string | null } = {
    updated_at: new Date().toISOString(),
  };
  if (typeof doc.title === 'string' && doc.title.trim()) patch.title = doc.title.trim();
  if (doc.description !== undefined) {
    patch.description =
      typeof doc.description === 'string' && doc.description.trim() ? doc.description.trim() : null;
  }
  if (!patch.title && patch.description === undefined) return;

  const { error } = await admin.from('courses').update(patch).eq('sanity_id', sanityId);
  if (error) console.error('[syncCourseRowFromSanity]', error);
  else revalidateTag('admin-panel-course-list', { expire: 0 });
}

export type AdminCourseBundle = {
  courseId: number;
  slug: string;
  dbTitle: string;
  sanityId: string | null;
  summary: DistrictCourseSummary | null;
};

const getCourseRowCached = unstable_cache(
  async (courseId: number) => {
    const admin = createAdminClient();
    const course = await getCourse(admin, courseId);
    return course ? { slug: course.slug, title: course.title, sanityId: (course as { sanity_id?: string | null }).sanity_id ?? null } : null;
  },
  ['admin-course-row'],
  { revalidate: 60, tags: ['admin-panel-course-list'] },
);

/** Лёгкий бандл: строка курса + сводка из Sanity (без выгрузки всех уроков). */
export async function loadAdminCourseBundle(
  _admin: SupabaseClient,
  courseId: number,
): Promise<AdminCourseBundle | null> {
  const course = await getCourseRowCached(courseId);
  if (!course) return null;

  const summaries = await listDistrictSummariesForAdmin();
  const summary = summaries.find((s) => s.slug === course.slug) ?? null;

  return {
    courseId,
    slug: course.slug,
    dbTitle: course.title,
    sanityId: summary?.sanityId ?? course.sanityId,
    summary,
  };
}
export async function loadAdminCourseStudents(
  admin: SupabaseClient,
  courseId: number,
  courseSlug: string,
) {
  return loadCuratorCourseStudents(admin, 0, {
    courseId,
    courseSlug,
    skipStaffCheck: true,
    fullPreview: true,
  });
}
