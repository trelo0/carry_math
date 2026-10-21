import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { SITE_URL_FALLBACK } from '@/lib/siteUrl';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { listCourseStudentTelegramIds } from '@/lib/curator/students';

export type LessonNotifyType = 'live' | 'materials' | 'recording';

export type LessonNotifyResult = {
  sent: number;
  skipped: number;
  failed: number;
  total: number;
};

async function listLessonStudentTelegramIds(
  admin: SupabaseClient,
  sanityLessonId: string,
): Promise<number[]> {
  const { data, error } = await admin
    .from('course_lesson_access')
    .select('telegram_id')
    .eq('sanity_lesson_id', sanityLessonId)
    .neq('access_status', 'revoked');
  if (error) throw error;

  const ids = new Set((data ?? []).map((row) => row.telegram_id as number));
  if (ids.size > 0) return [...ids];

  const content = await getDistrictCourseContent();
  if (!content) return [];

  let courseId: number | null = null;
  try {
    courseId = await resolveCourseIdForContent(admin, content);
  } catch {
    courseId = null;
  }
  if (!courseId) return [];

  const enrolled = await listCourseStudentTelegramIds(admin, courseId);
  for (const telegramId of enrolled) {
    const { count, error: countError } = await admin
      .from('course_lesson_access')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', telegramId)
      .not('sanity_lesson_id', 'is', null);
    if (countError) throw countError;
    if ((count ?? 0) > 0) continue;
    ids.add(telegramId);
  }

  return [...ids];
}

function buildNotifyContent(
  type: LessonNotifyType,
  lessonNumber: number,
  title: string,
): { text: string; buttonText: string } {
  const header = `Занятие №${lessonNumber}: ${title}`;
  if (type === 'live') {
    return {
      text: `🔴 Эфир начался\n\n${header}`,
      buttonText: '🔴 Открыть трансляцию',
    };
  }
  if (type === 'materials') {
    return {
      text: `📎 Материалы к занятию опубликованы\n\n${header}`,
      buttonText: '📎 Открыть материалы',
    };
  }
  return {
    text: `🎬 Запись занятия готова\n\n${header}`,
    buttonText: '🎬 Смотреть запись',
  };
}

function lessonCabinetPath(sanityLessonId: string): string {
  return `/cabinet/lesson/${encodeURIComponent(sanityLessonId)}`;
}

/** Inline-кнопки в TG не принимают localhost — всегда прод-домен как запасной. */
function resolveNotifyButtonUrl(cabinetUrl: string, sanityLessonId: string): string {
  if (/^https:\/\/district-school\.by/i.test(cabinetUrl)) return cabinetUrl;
  if (!/localhost|127\.0\.0\.1/i.test(cabinetUrl)) return cabinetUrl;
  try {
    const parsed = new URL(cabinetUrl);
    return `${SITE_URL_FALLBACK}${parsed.pathname}${parsed.search}`;
  } catch {
    return `${SITE_URL_FALLBACK}${lessonCabinetPath(sanityLessonId)}`;
  }
}

function formatNotifyResult(result: LessonNotifyResult): string {
  if (result.total === 0) {
    return 'Нет учеников с доступом к этому занятию — сообщения не отправлены.';
  }
  if (result.sent === 0) {
    return `Не удалось доставить ни одного сообщения (${result.failed} ошибок, ${result.skipped} без чата). Ученик должен написать боту /start.`;
  }
  const parts = [`Отправлено: ${result.sent} из ${result.total}`];
  if (result.skipped > 0) parts.push(`без чата: ${result.skipped}`);
  if (result.failed > 0) parts.push(`ошибок: ${result.failed}`);
  return parts.join(' · ');
}

/** Уведомляет учеников с доступом к занятию (TG). */
export async function notifyStudentsLessonEvent(
  admin: SupabaseClient,
  sanityLessonId: string,
  type: LessonNotifyType,
): Promise<LessonNotifyResult & { message: string }> {
  const content = await getDistrictCourseContent();
  if (!content) {
    const empty = { sent: 0, skipped: 0, failed: 0, total: 0 };
    return { ...empty, message: formatNotifyResult(empty) };
  }
  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson) {
    const empty = { sent: 0, skipped: 0, failed: 0, total: 0 };
    return { ...empty, message: formatNotifyResult(empty) };
  }

  const studentIds = await listLessonStudentTelegramIds(admin, sanityLessonId);
  const total = studentIds.length;
  if (total === 0) {
    const empty = { sent: 0, skipped: 0, failed: 0, total: 0 };
    return { ...empty, message: formatNotifyResult(empty) };
  }

  const { data: members } = await admin
    .from('bot_members')
    .select('telegram_id, chat_id')
    .in('telegram_id', studentIds);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const studentId of studentIds) {
    const member = (members ?? []).find((m) => m.telegram_id === studentId);
    const chatId = (member?.chat_id as number | undefined) ?? studentId;
    if (!chatId) {
      skipped += 1;
      continue;
    }
    let cabinetUrl: string;
    try {
      cabinetUrl = await createCabinetLoginUrl(admin, studentId, lessonCabinetPath(sanityLessonId));
    } catch {
      cabinetUrl = `${SITE_URL_FALLBACK}${lessonCabinetPath(sanityLessonId)}`;
    }
    cabinetUrl = resolveNotifyButtonUrl(cabinetUrl, sanityLessonId);
    const { text, buttonText } = buildNotifyContent(type, lesson.lessonNumber, lesson.title);
    const response = await telegramSend('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: buttonText, url: cabinetUrl }]],
      },
    });
    if (!response.ok) {
      console.warn('[lesson-notify]', { studentId, chatId, error: response.description });
      failed += 1;
      continue;
    }
    sent += 1;
  }

  const result = { sent, skipped, failed, total };
  return { ...result, message: formatNotifyResult(result) };
}
