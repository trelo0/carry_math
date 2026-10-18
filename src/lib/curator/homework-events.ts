import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findLessonBySanityId,
  type CourseHomeworkSubmitInput,
} from '@/lib/bot/education/course-homework';
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

/** Push проверяющему после сдачи ДЗ (сайт или бот). */
export async function notifyCuratorHomeworkSubmitted(
  admin: SupabaseClient,
  studentTelegramId: number,
  sanityLessonId: string,
  input: CourseHomeworkSubmitInput,
): Promise<void> {
  const { resolveCourseForSanityLesson } = await import('@/lib/bot/education/student-course-context');
  const resolved = await resolveCourseForSanityLesson(admin, studentTelegramId, sanityLessonId);
  const content = resolved?.content ?? (await getDistrictCourseContent().catch(() => null));
  if (!content) return;
  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson) return;

  const courseId = resolved?.courseId ?? null;
  if (courseId == null) return;

  const studentName = await studentDisplayName(admin, studentTelegramId);
  await notifyCheckHomeworkSubmitted(admin, {
    courseId,
    studentTelegramId,
    studentName,
    lessonNumber: lesson.lessonNumber,
    lessonTitle: lesson.title,
    fileUrl: input.fileUrl?.trim() || null,
    note: input.note?.trim() || null,
  });
}

/** Уведомление проверяющему о новой сдаче ДЗ. */
export async function notifyCheckHomeworkSubmitted(
  admin: SupabaseClient,
  params: {
    courseId: number;
    studentTelegramId: number;
    studentName: string;
    lessonNumber: number;
    lessonTitle: string;
    fileUrl: string | null;
    note: string | null;
  },
): Promise<void> {
  const { resolveCourseCheckStaffTelegramId } = await import('@/lib/bot/education/course-staff');
  const checkId = await resolveCourseCheckStaffTelegramId(admin, params.courseId);
  if (!checkId) return;

  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', checkId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const { telegramSend } = await import('@/lib/telegram');
  const lines = [
    '📝 Новое ДЗ на проверку',
    '',
    `👨‍🎓 ${params.studentName}`,
    `Занятие №${params.lessonNumber}: ${params.lessonTitle}`,
  ];
  if (params.note?.trim()) lines.push('', params.note.trim());
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Закрыть', callback_data: 'k:ntf:close' },
          {
            text: 'Посмотреть',
            callback_data: `k:hw:${params.courseId}:i:${params.studentTelegramId}:${params.lessonNumber}`,
          },
        ],
      ],
    },
  });
}
