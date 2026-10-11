import type { SupabaseClient } from '@supabase/supabase-js';
import { getDistrictCourseContent, flattenCourseLessons } from '@/lib/studio/courseContent';
import {
  canStudentWatchSanityLesson,
  unlockNextCourseLessonAfterCleared,
} from '@/lib/bot/education/course-access';
import {
  markLiveAttended,
  markRecordingWatched,
  reportMaterialOpened,
  reportWatchPercent,
  type CourseLessonStudentProgress,
} from '@/lib/bot/education/course-progress';
import { isLessonProgressCompleted, lessonHasHomework } from '@/lib/bot/education/lesson-progress-calc';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { ensureHomeworkDeadlineStarted } from '@/lib/bot/education/homework-deadline';

export class CourseWatchDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseWatchDeniedError';
  }
}

async function afterProgressMaybeCompleteAndUnlock(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  progress: CourseLessonStudentProgress,
): Promise<void> {
  const content = await getDistrictCourseContent().catch(() => null);
  if (!content) return;
  const lesson = flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId);
  if (!lesson) return;

  const done = isLessonProgressCompleted({
    recordingWatchedAt: progress.recording_watched_at,
    liveAttendedAt: progress.live_attended_at,
    homeworkStatus: progress.homework_status,
    hasHomework: lessonHasHomework(lesson),
  });

  if (done && !progress.completed_at) {
    await admin
      .from('course_lesson_student_progress')
      .update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('telegram_id', telegramId)
      .eq('sanity_lesson_id', sanityLessonId);
  }

  if (!done) return;

  try {
    const courseId = await resolveCourseIdForContent(admin, content);
    if (courseId) {
      await unlockNextCourseLessonAfterCleared(admin, telegramId, courseId, content);
    }
  } catch (error) {
    console.error('[courseWatch] unlock after progress failed:', error);
  }
}

async function startDeadlineIfNeeded(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<void> {
  try {
    await ensureHomeworkDeadlineStarted(admin, telegramId, sanityLessonId, { hasAccess: true });
  } catch (error) {
    console.error('[courseWatch] deadline start failed:', error);
  }
}

export async function watchRecordingWithAccessGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent?: number,
): Promise<CourseLessonStudentProgress> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseWatchDeniedError('Курс не найден.');

  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  await startDeadlineIfNeeded(admin, telegramId, sanityLessonId);
  const progress = await markRecordingWatched(admin, telegramId, { sanityLessonId }, watchPercent);
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress);
  return progress;
}

export async function watchLiveWithAccessGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent?: number,
): Promise<CourseLessonStudentProgress> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseWatchDeniedError('Курс не найден.');

  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  await startDeadlineIfNeeded(admin, telegramId, sanityLessonId);
  const progress = await markLiveAttended(admin, telegramId, { sanityLessonId }, watchPercent);
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress);
  return progress;
}

export async function reportLessonWatchPercentWithGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent: number,
): Promise<CourseLessonStudentProgress> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseWatchDeniedError('Курс не найден.');

  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  // Таймер ДЗ стартует только по Play (watch-live / watch-recording), не по percent/material.
  const progress = await reportWatchPercent(admin, telegramId, sanityLessonId, watchPercent);
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress);
  return progress;
}

export async function reportLessonMaterialOpenedWithGate(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  materialKey: string,
): Promise<CourseLessonStudentProgress> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseWatchDeniedError('Курс не найден.');

  const gate = await canStudentWatchSanityLesson(admin, telegramId, sanityLessonId, content);
  if (!gate.ok) throw new CourseWatchDeniedError(gate.reason);

  const progress = await reportMaterialOpened(admin, telegramId, sanityLessonId, materialKey);
  await afterProgressMaybeCompleteAndUnlock(admin, telegramId, sanityLessonId, progress);
  return progress;
}
