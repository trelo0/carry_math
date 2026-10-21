import type { SupabaseClient } from '@supabase/supabase-js';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
import {
  canStudentWatchSanityLesson,
  unlockNextCourseLessonAfterCleared,
  studentHasCourseAccessForCourse,
} from '@/lib/bot/education/course-access';
import {
  markLiveAttended,
  markRecordingWatched,
  reportMaterialOpened,
  reportWatchPercent,
  type CourseLessonStudentProgress,
} from '@/lib/bot/education/course-progress';
import { isLessonProgressCompleted } from '@/lib/bot/education/lesson-progress-calc';
import { ensureHomeworkDeadlineStarted } from '@/lib/bot/education/homework-deadline';
import { homeworkRequiredForLesson } from '@/lib/bot/education/lesson-progress-calc';
import { resolveCourseForSanityLesson } from '@/lib/bot/education/student-course-context';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';

export class CourseWatchDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseWatchDeniedError';
  }
}

async function resolveLessonCourseContext(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  preferredCourseSlug?: string | null,
): Promise<{ content: DistrictCourseContent; courseId: number }> {
  const resolved = await resolveCourseForSanityLesson(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  if (!resolved) {
    throw new CourseWatchDeniedError(
      preferredCourseSlug
        ? 'Занятие не найдено в выбранном курсе.'
        : 'Укажите курс или выберите занятие из карты курса.',
    );
  }
  return { content: resolved.content, courseId: resolved.courseId };
}

async function afterProgressMaybeCompleteAndUnlock(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  progress: CourseLessonStudentProgress,
  ctx: { content: DistrictCourseContent; courseId: number },
): Promise<void> {
  const { content, courseId } = ctx;
  const lesson = flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId);
  if (!lesson) return;

  const { loadJoinCurrentGateContext, isJoinArchiveSanityId } = await import(
    './course-enrollment-start'
  );
  const joinGate = await loadJoinCurrentGateContext(admin, telegramId, courseId, content);
  if (isJoinArchiveSanityId(joinGate, sanityLessonId)) return;

  const hasCourseProduct = await studentHasCourseAccessForCourse(admin, telegramId, courseId);
  const hwForCompletion = homeworkRequiredForLesson(lesson, hasCourseProduct);
  const done = isLessonProgressCompleted({
    recordingWatchedAt: progress.recording_watched_at,
    liveAttendedAt: progress.live_attended_at,
    homeworkStatus: progress.homework_status,
    hasHomework: hwForCompletion,
  });

  if (done && !progress.completed_at) {
    await admin
      .from('course_lesson_student_progress')
      .update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('telegram_id', telegramId)
      .eq('course_id', courseId)
      .eq('sanity_lesson_id', sanityLessonId);
  }

  if (!done) return;

  try {
    await unlockNextCourseLessonAfterCleared(admin, telegramId, courseId, content);
  } catch (error) {
    console.error('[courseWatch] unlock after progress failed:', error);
  }
}

async function startDeadlineIfNeeded(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  lesson: { isTrialFree: boolean },
  hasCourseProduct: boolean,
  content: DistrictCourseContent,
  courseId: number,
): Promise<void> {
  if (lesson.isTrialFree && !hasCourseProduct) return;
  const { loadJoinCurrentGateContext, isJoinArchiveSanityId } = await import(
    './course-enrollment-start'
  );
  const joinGate = await loadJoinCurrentGateContext(admin, telegramId, courseId, content);
  if (isJoinArchiveSanityId(joinGate, sanityLessonId)) return;
  try {
    await ensureHomeworkDeadlineStarted(admin, telegramId, sanityLessonId, {
      hasAccess: true,
      courseId,
    });
  } catch (error) {
    console.error('[courseWatch] deadline start failed:', error);
  }
}

export async function watchRecordingWithAccessGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent?: number,
  preferredCourseSlug?: string | null,
): Promise<CourseLessonStudentProgress> {
  const ctx = await resolveLessonCourseContext(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, ctx.content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  const lesson = flattenCourseLessons(ctx.content).find((l) => l.sanityId === sanityLessonId);
  const hasCourseProduct = await studentHasCourseAccessForCourse(
    admin,
    telegramId,
    ctx.courseId,
  );
  const progress = await markRecordingWatched(
    admin,
    telegramId,
    { courseId: ctx.courseId, sanityLessonId },
    watchPercent,
  );
  if (lesson) {
    await startDeadlineIfNeeded(
      admin,
      telegramId,
      sanityLessonId,
      lesson,
      hasCourseProduct,
      ctx.content,
      ctx.courseId,
    );
  }
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress, ctx);
  return progress;
}

export async function watchLiveWithAccessGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent?: number,
  preferredCourseSlug?: string | null,
): Promise<CourseLessonStudentProgress> {
  const ctx = await resolveLessonCourseContext(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, ctx.content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  const lesson = flattenCourseLessons(ctx.content).find((l) => l.sanityId === sanityLessonId);
  const hasCourseProduct = await studentHasCourseAccessForCourse(
    admin,
    telegramId,
    ctx.courseId,
  );
  const progress = await markLiveAttended(
    admin,
    telegramId,
    { courseId: ctx.courseId, sanityLessonId },
    watchPercent,
  );
  if (lesson) {
    await startDeadlineIfNeeded(
      admin,
      telegramId,
      sanityLessonId,
      lesson,
      hasCourseProduct,
      ctx.content,
      ctx.courseId,
    );
  }
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress, ctx);
  return progress;
}

export async function reportLessonWatchPercentWithGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent: number,
  preferredCourseSlug?: string | null,
): Promise<CourseLessonStudentProgress> {
  const ctx = await resolveLessonCourseContext(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, ctx.content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  const progress = await reportWatchPercent(
    admin,
    telegramId,
    sanityLessonId,
    watchPercent,
    ctx.courseId,
  );
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress, ctx);
  return progress;
}

export async function reportLessonMaterialOpenedWithGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  materialKey: string,
  preferredCourseSlug?: string | null,
): Promise<CourseLessonStudentProgress> {
  const ctx = await resolveLessonCourseContext(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, ctx.content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  const progress = await reportMaterialOpened(
    admin,
    telegramId,
    sanityLessonId,
    materialKey,
    ctx.courseId,
  );
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress, ctx);
  return progress;
}
