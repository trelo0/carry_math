import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudentCurator } from '@/lib/bot/education/assignments';
import {
  findLessonBySanityId,
  type CourseHomeworkSubmitInput,
} from '@/lib/bot/education/course-homework';
import { sendSubmissionToCurator } from '@/lib/bot/studentHomeworkFlow';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

async function studentDisplayName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from('student_profiles').select('display_name').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('bot_members').select('full_name').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  return (
    (profile?.display_name as string | undefined) ||
    (member?.full_name as string | undefined) ||
    `Ученик ${telegramId}`
  );
}

/** Push куратору после сдачи ДЗ (сайт или бот). */
export async function notifyCuratorHomeworkSubmitted(
  admin: SupabaseClient,
  studentTelegramId: number,
  sanityLessonId: string,
  input: CourseHomeworkSubmitInput,
): Promise<void> {
  const content = await getDistrictCourseContent();
  if (!content) return;
  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson) return;

  const curator = await getStudentCurator(admin, studentTelegramId);
  if (!curator) return;

  const studentName = await studentDisplayName(admin, studentTelegramId);
  await sendSubmissionToCurator(admin, curator.telegramId, {
    studentName,
    lessonNumber: lesson.lessonNumber,
    title: lesson.title,
    fileUrl: input.fileUrl?.trim() || null,
    note: input.note?.trim() || null,
  });
}
