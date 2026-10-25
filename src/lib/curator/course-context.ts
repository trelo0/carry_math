import type { SupabaseClient } from '@supabase/supabase-js';
import { listCoursesForStaff, staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { listDistrictCourseSummaries } from '@/lib/studio/courseContent';

export type CuratorCourseOption = {
  courseId: number;
  slug: string;
  title: string;
};

export type StaffCourseAssignmentOption = CuratorCourseOption & {
  role: 'curator' | 'check';
};

/** Курсы с назначением curator или check (не глобальная роль). */
export async function listStaffCourseAssignmentOptions(
  admin: SupabaseClient,
  staffTelegramId: number,
  options?: { fullPreview?: boolean },
): Promise<StaffCourseAssignmentOption[]> {
  const fullPreview = options?.fullPreview ?? false;

  if (fullPreview) {
    const summaries = await listDistrictCourseSummaries().catch(() => []);
    const slugs = summaries.map((s) => s.slug);
    const idBySlug = await lookupCourseIdsBySlugs(admin, slugs);
    const out: StaffCourseAssignmentOption[] = [];
    for (const s of summaries) {
      const courseId = idBySlug.get(s.slug);
      if (courseId == null) continue;
      out.push({ courseId, slug: s.slug, title: s.title, role: 'curator' });
    }
    return out;
  }

  const assigned = await listCoursesForStaff(admin, staffTelegramId);
  const relevant = assigned.filter((a) => a.role === 'curator' || a.role === 'check');
  if (relevant.length === 0) return [];

  const courseIds = [...new Set(relevant.map((a) => a.courseId))];
  const { data: rows, error } = await admin
    .from('courses')
    .select('id, slug, title')
    .in('id', courseIds);
  if (error) throw error;
  const byId = new Map(
    (rows ?? []).map((r) => [
      r.id as number,
      { slug: r.slug as string, title: (r.title as string) ?? 'Курс' },
    ]),
  );

  const out: StaffCourseAssignmentOption[] = [];
  for (const a of relevant) {
    if (a.role !== 'curator' && a.role !== 'check') continue;
    const meta = byId.get(a.courseId);
    out.push({
      courseId: a.courseId,
      slug: meta?.slug ?? `course-${a.courseId}`,
      title: meta?.title ?? `Курс #${a.courseId}`,
      role: a.role,
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.role.localeCompare(b.role));
  return out;
}

export type PickStaffCourseOptions = {
  courseId?: number | null;
  courseSlug?: string | null;
  courseRole?: 'curator' | 'check' | null;
};

/** Чистая логика выбора курса из уже загруженных назначений (для тестов и UI). */
export function pickStaffCourseAssignment(
  courses: StaffCourseAssignmentOption[],
  options?: PickStaffCourseOptions | null,
): StaffCourseAssignmentOption | null {
  if (courses.length === 0) return null;

  let pick =
    options?.courseId != null
      ? courses.filter((c) => c.courseId === options.courseId)
      : options?.courseSlug
        ? courses.filter((c) => c.slug === options.courseSlug)
        : courses.length === 1
          ? courses
          : [];

  if (pick.length > 1 && options?.courseRole) {
    const preferred = pick.filter((c) => c.role === options.courseRole);
    if (preferred.length > 0) pick = preferred;
  } else if (pick.length > 1 && options?.courseId != null) {
    const curatorFirst = pick.find((c) => c.role === 'curator');
    if (curatorFirst) pick = [curatorFirst];
  }

  if (pick.length === 0) return null;
  return pick[0] ?? null;
}

export async function resolveStaffCourseContext(
  admin: SupabaseClient,
  staffTelegramId: number,
  options?: PickStaffCourseOptions & {
    fullPreview?: boolean;
    /** Уже загруженный список назначений — экономит запросы. */
    preloaded?: StaffCourseAssignmentOption[];
  },
): Promise<StaffCourseAssignmentOption | null> {
  const courses =
    options?.preloaded ??
    (await listStaffCourseAssignmentOptions(admin, staffTelegramId, {
      fullPreview: options?.fullPreview,
    }));
  if (courses.length === 0) return null;

  const fullPreview = options?.fullPreview ?? false;
  const picked = pickStaffCourseAssignment(courses, options);
  if (!picked) return null;

  const pick = [picked];

  if (!fullPreview) {
    for (const candidate of pick) {
      const ok = await staffHasCourseAccess(
        admin,
        staffTelegramId,
        candidate.courseId,
        candidate.role,
      );
      if (ok) return candidate;
    }
    return null;
  }

  return pick[0] ?? null;
}

export async function listCuratorCourseOptions(
  admin: SupabaseClient,
  curatorTelegramId: number,
  options?: { fullPreview?: boolean },
): Promise<CuratorCourseOption[]> {
  const fullPreview = options?.fullPreview ?? false;

  if (fullPreview) {
    const summaries = await listDistrictCourseSummaries().catch(() => []);
    const slugs = summaries.map((s) => s.slug);
    const idBySlug = await lookupCourseIdsBySlugs(admin, slugs);
    const out: CuratorCourseOption[] = [];
    for (const s of summaries) {
      const courseId = idBySlug.get(s.slug);
      if (courseId == null) continue;
      out.push({ courseId, slug: s.slug, title: s.title });
    }
    return out;
  }

  const assigned = await listCoursesForStaff(admin, curatorTelegramId, 'curator');
  if (assigned.length === 0) return [];

  const courseIds = [...new Set(assigned.map((a) => a.courseId))];
  const { data: rows, error } = await admin
    .from('courses')
    .select('id, slug, title')
    .in('id', courseIds);
  if (error) throw error;

  return (rows ?? []).map((r) => ({
    courseId: r.id as number,
    slug: r.slug as string,
    title: (r.title as string) ?? 'Курс',
  }));
}

export async function resolveCuratorCourseContext(
  admin: SupabaseClient,
  curatorTelegramId: number,
  options?: {
    courseId?: number | null;
    courseSlug?: string | null;
    fullPreview?: boolean;
  },
): Promise<CuratorCourseOption | null> {
  const courses = await listCuratorCourseOptions(admin, curatorTelegramId, {
    fullPreview: options?.fullPreview,
  });
  if (courses.length === 0) return null;

  const byId = options?.courseId != null ? courses.find((c) => c.courseId === options.courseId) : null;
  if (byId) {
    if (!options?.fullPreview) {
      const ok = await staffHasCourseAccess(admin, curatorTelegramId, byId.courseId, 'curator');
      if (!ok) return null;
    }
    return byId;
  }

  if (options?.courseSlug) {
    const bySlug = courses.find((c) => c.slug === options.courseSlug);
    if (bySlug) {
      if (!options?.fullPreview) {
        const ok = await staffHasCourseAccess(admin, curatorTelegramId, bySlug.courseId, 'curator');
        if (!ok) return null;
      }
      return bySlug;
    }
  }

  if (courses.length === 1) return courses[0]!;
  return null;
}
