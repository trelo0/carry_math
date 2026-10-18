import type { SupabaseClient } from '@supabase/supabase-js';
import type { PurchaseRequestRow } from '@/lib/bot/purchase-requests';
import { completeCoursePurchaseSideEffects } from '@/lib/bot/packages';
import { resetTrialHomeworkDeadlineOnCoursePurchase } from '@/lib/bot/education/homework-deadline';
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

  if (purchaseRequest.product !== 'course') {
    return { courseId, startModuleId, startLessonId, curatorTelegramId };
  }

  let courseSlug = purchaseRequest.course_slug?.trim() || null;
  if (!courseSlug && purchaseRequest.id) {
    const { data: reqRow } = await admin
      .from('purchase_requests')
      .select('course_slug')
      .eq('id', purchaseRequest.id)
      .maybeSingle();
    courseSlug = (reqRow?.course_slug as string | undefined)?.trim() || null;
  }
  if (!courseSlug) {
    return { courseId, startModuleId, startLessonId, curatorTelegramId };
  }

  const { resolveCourseIdForContent } = await import('@/lib/bot/education/course-record');
  const { resolveJoinCurrentStartIds, findFirstPaidLesson } = await import(
    '@/lib/bot/education/active-module'
  );

  const courseContent = await getDistrictCourseContent(courseSlug).catch(() => null);
  if (!courseContent) {
    return { courseId, startModuleId, startLessonId, curatorTelegramId };
  }

  curatorTelegramId = courseContent.curatorTelegramId ?? null;
  courseId = await resolveCourseIdForContent(admin, courseContent);

  if (scenario === 'join_current' && courseId) {
    const joinStart = await resolveJoinCurrentStartIds(admin, courseId, courseContent);
    startModuleId = joinStart.startModuleId;
    startLessonId = joinStart.startLessonId;
    if (!joinStart.startLessonSanityId) {
      console.warn('[fulfill-from-request] join_current: active module / first lesson not resolved');
    } else if (!startLessonId) {
      console.warn(
        '[fulfill-from-request] join_current: no course_lessons row for',
        joinStart.startLessonSanityId,
      );
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

  await resetTrialHomeworkDeadlineOnCoursePurchase(
    admin,
    purchaseRequest.telegram_id,
    purchaseRequest.course_slug,
  );
}
