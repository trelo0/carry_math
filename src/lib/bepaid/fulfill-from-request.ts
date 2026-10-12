import type { SupabaseClient } from '@supabase/supabase-js';
import type { PurchaseRequestRow } from '@/lib/bot/purchase-requests';
import { completeCoursePurchaseSideEffects } from '@/lib/bot/packages';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

export type CourseFulfillContext = {
  courseId: number | null;
  startModuleId: number | null;
  startLessonId: number | null;
  curatorTelegramId: number | null;
};

export async function resolveCourseFulfillContext(
  admin: SupabaseClient,
  purchaseRequest: PurchaseRequestRow,
  scenario: 'start_from_beginning' | 'join_current' | undefined,
): Promise<CourseFulfillContext> {
  let courseId: number | null = null;
  let startModuleId: number | null = null;
  let startLessonId: number | null = null;
  let curatorTelegramId: number | null = null;

  if (purchaseRequest.product !== 'course' || !purchaseRequest.course_slug) {
    return { courseId, startModuleId, startLessonId, curatorTelegramId };
  }

  const { resolveCourseIdForContent } = await import('@/lib/bot/education/course-record');
  const { determineActiveModule, findFirstLessonInModule, findFirstPaidLesson } = await import(
    '@/lib/bot/education/active-module'
  );

  const courseContent = await getDistrictCourseContent(purchaseRequest.course_slug).catch(() => null);
  if (!courseContent) {
    return { courseId, startModuleId, startLessonId, curatorTelegramId };
  }

  curatorTelegramId = courseContent.curatorTelegramId ?? null;
  courseId = await resolveCourseIdForContent(admin, courseContent);

  if (scenario === 'join_current' && courseId) {
    const activeModuleResult = await determineActiveModule(admin, courseContent);
    if (activeModuleResult.module) {
      const { data: moduleRow } = await admin
        .from('course_modules')
        .select('id')
        .eq('course_id', courseId)
        .eq('sort_order', activeModuleResult.module.sortOrder)
        .maybeSingle();
      if (moduleRow?.id) {
        startModuleId = moduleRow.id as number;
        const firstLessonSanityId = findFirstLessonInModule(activeModuleResult.module);
        if (firstLessonSanityId) {
          const { data: lessonRow } = await admin
            .from('course_lessons')
            .select('id')
            .eq('course_id', courseId)
            .eq('sanity_lesson_id', firstLessonSanityId)
            .maybeSingle();
          if (lessonRow?.id) startLessonId = lessonRow.id as number;
        }
      }
    }
  } else if (scenario === 'start_from_beginning' && courseId) {
    const firstPaidSanityId = findFirstPaidLesson(courseContent);
    if (firstPaidSanityId) {
      const { data: lessonRow } = await admin
        .from('course_lessons')
        .select('id')
        .eq('course_id', courseId)
        .eq('sanity_lesson_id', firstPaidSanityId)
        .maybeSingle();
      if (lessonRow?.id) startLessonId = lessonRow.id as number;
    }
  }

  return { courseId, startModuleId, startLessonId, curatorTelegramId };
}

export async function runCourseSideEffectsAfterFulfill(
  admin: SupabaseClient,
  purchaseRequest: PurchaseRequestRow,
  packageId: number,
  lessons: number,
  courseContext: CourseFulfillContext,
): Promise<void> {
  if (purchaseRequest.product !== 'course' || !courseContext.courseId) return;

  await completeCoursePurchaseSideEffects(admin, purchaseRequest.telegram_id, {
    courseId: courseContext.courseId,
    courseSlug: purchaseRequest.course_slug ?? undefined,
    packageId,
    lessons,
    curatorTelegramId: courseContext.curatorTelegramId ?? undefined,
  });
}
