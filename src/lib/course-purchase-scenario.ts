import { courseLessonPackageMatchesCourse } from '@/lib/bot/education/course-access';

export type PurchaseScenario = 'start_from_beginning' | 'join_current';

export function purchaseScenarioLabel(scenario: PurchaseScenario | null | undefined): string | null {
  if (scenario === 'start_from_beginning') return 'С начала курса';
  if (scenario === 'join_current') return 'С текущего модуля';
  return null;
}

export function sumActiveCoursePackages(
  packages: {
    product: string;
    remaining: number;
    total: number;
    active: boolean;
    courseId?: number | null;
    title?: string;
  }[],
  courseId?: number | null,
  options?: {
    courseSlug?: string | null;
    courseTitle?: string | null;
    aliasCourseIds?: number[];
  },
): { remaining: number; total: number; hasActiveRemaining: boolean } {
  const aliasSet = new Set([...(options?.aliasCourseIds ?? []), ...(courseId != null ? [courseId] : [])]);
  const courseRows = packages.filter((p) => {
    if (p.product !== 'course' || !p.active) return false;
    if (courseId == null) return true;
    if (p.courseId != null && aliasSet.has(p.courseId)) return true;
    return courseLessonPackageMatchesCourse(
      p.courseId,
      p.title,
      courseId,
      options?.courseSlug,
      options?.courseTitle,
    );
  });
  return {
    remaining: courseRows.reduce((sum, p) => sum + p.remaining, 0),
    total: courseRows.reduce((sum, p) => sum + p.total, 0),
    hasActiveRemaining: courseRows.some((p) => p.remaining > 0),
  };
}
