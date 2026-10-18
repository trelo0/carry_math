import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getStudentCheckStaff } from '@/lib/bot/education/assignments';
import { getAdminNotifyChatIds } from './lives-notify';
import { flattenCourseLessons, getDistrictCourseContent } from '@/lib/studio/courseContent';
import { getEnrollmentLives } from './lives';
import {
  claimDeadlineReminder,
  ensureOverdueMarked,
  listActiveHomeworkDeadlines,
  type ActiveDeadlineRow,
} from './homework-deadline';

const MS_12H = 12 * 60 * 60 * 1000;
const MS_6H = 6 * 60 * 60 * 1000;
const MS_2H = 2 * 60 * 60 * 1000;

async function memberChatId(admin: SupabaseClient, telegramId: number): Promise<number | null> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return (data?.chat_id as number | null) ?? null;
}

async function memberName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return (data?.full_name as string | null)?.trim() || `Ученик ${telegramId}`;
}

function lessonCabinetUrl(sanityLessonId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/cabinet/lesson/${sanityLessonId}` : `/cabinet/lesson/${sanityLessonId}`;
}

function formatDeadlineRu(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function resolveLessonTitle(sanityLessonId: string): Promise<{ title: string; hwTitle: string; lessonNumber: number | null }> {
  const content = await getDistrictCourseContent().catch(() => null);
  const lesson = content
    ? flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId)
    : null;
  return {
    title: lesson?.title ?? 'Занятие',
    hwTitle: lesson?.homework?.title?.trim() || lesson?.title || 'Домашнее задание',
    lessonNumber: lesson?.lessonNumber ?? null,
  };
}

async function sendStudentReminder(
  admin: SupabaseClient,
  row: ActiveDeadlineRow,
  kind: '12h' | '6h' | '2h' | 'overdue',
): Promise<boolean> {
  const column =
    kind === '12h'
      ? 'hw_remind_12h_at'
      : kind === '6h'
        ? 'hw_remind_6h_at'
        : kind === '2h'
          ? 'hw_remind_2h_at'
          : 'hw_overdue_student_at';
  const claimed = await claimDeadlineReminder(
    admin,
    row.telegram_id,
    row.sanity_lesson_id as string,
    column,
  );
  if (!claimed) return false;

  const chatId = await memberChatId(admin, row.telegram_id);
  if (!chatId) return true; // claimed — не ретраим статус

  const { title, hwTitle } = await resolveLessonTitle(row.sanity_lesson_id as string);
  const deadline = row.homework_deadline_at ? formatDeadlineRu(row.homework_deadline_at) : '—';
  const url = lessonCabinetUrl(row.sanity_lesson_id as string);

  const head =
    kind === 'overdue'
      ? '⏰ Срок сдачи ДЗ истёк'
      : kind === '2h'
        ? '⏰ До дедлайна ДЗ осталось ~2 часа'
        : kind === '6h'
          ? '⏰ До дедлайна ДЗ осталось ~6 часов'
          : '⏰ До дедлайна ДЗ осталось ~12 часов';

  try {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: [
        head,
        '',
        `📚 ${title}`,
        `📝 ${hwTitle}`,
        `🕐 Срок: ${deadline} (МСК)`,
        '',
        `Открыть: ${url}`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[hw-deadline] student remind failed:', err);
  }
  return true;
}

/** Просрочка ДЗ: проверяющий курса + админы (колонка hw_overdue_curator_at — историческое имя). */
export async function notifyCuratorOverdueOnce(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<boolean> {
  await ensureOverdueMarked(admin, telegramId, sanityLessonId);
  const claimed = await claimDeadlineReminder(
    admin,
    telegramId,
    sanityLessonId,
    'hw_overdue_curator_at',
  );
  if (!claimed) return false;

  const { resolveCourseForSanityLesson } = await import('./student-course-context');
  const resolved = await resolveCourseForSanityLesson(admin, telegramId, sanityLessonId).catch(() => null);
  const courseId = resolved?.courseId ?? null;

  const [name, meta] = await Promise.all([
    memberName(admin, telegramId),
    resolveLessonTitle(sanityLessonId),
  ]);
  const lives =
    courseId != null ? await getEnrollmentLives(admin, telegramId, courseId).catch(() => null) : null;

  const { data: progress } = await admin
    .from('course_lesson_student_progress')
    .select('homework_deadline_at, homework_overdue_at')
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();

  const deadlineIso = (progress?.homework_deadline_at as string | null) ?? null;
  const overdueIso = (progress?.homework_overdue_at as string | null) ?? null;
  const overdueLabel = overdueIso
    ? formatDeadlineRu(overdueIso)
    : deadlineIso
      ? formatDeadlineRu(deadlineIso)
      : '—';

  const hwNum = meta.lessonNumber ?? 0;
  const overdueText = [
    '⏰ Просрочено домашнее задание',
    '',
    `👤 ${name}`,
    `📚 ${meta.title}`,
    `📝 ${meta.hwTitle}`,
    `🕐 Дедлайн: ${deadlineIso ? formatDeadlineRu(deadlineIso) : '—'} (МСК)`,
    `⏱ Просрочено: ${overdueLabel}`,
    `❤️ Жизней: ${lives ? `${lives.lives_current} из ${lives.lives_max}` : '—'}`,
  ].join('\n');

  if (courseId != null) {
    const checker = await getStudentCheckStaff(admin, telegramId, courseId);
    const checkChat = checker ? await memberChatId(admin, checker.telegramId) : null;
    if (checkChat) {
      try {
        await telegramSend('sendMessage', {
          chat_id: checkChat,
          text: overdueText,
          reply_markup: {
            inline_keyboard: [
              [{ text: '💬 Связаться', callback_data: `k:msg:${courseId}:w:${telegramId}` }],
              ...(hwNum > 0
                ? [
                    [
                      {
                        text: '❤️ Снять жизнь',
                        callback_data: `k:life:${courseId}:ask:${telegramId}:${hwNum}`,
                      },
                    ],
                  ]
                : []),
              [
                {
                  text: '📤 Отправить администратору',
                  callback_data: `k:od:adm:${courseId}:${telegramId}:${hwNum}`,
                },
              ],
            ],
          },
        });
        return true;
      } catch (err) {
        console.error('[hw-deadline] check overdue notify failed:', err);
      }
    }
  }

  await notifyAdminsHomeworkOverdue(admin, telegramId, overdueText);
  return true;
}

export async function notifyAdminsHomeworkOverdue(
  admin: SupabaseClient,
  studentTelegramId: number,
  overdueText: string,
): Promise<void> {
  const adminChats = await getAdminNotifyChatIds(admin);
  for (const chatId of adminChats) {
    try {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: overdueText,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⏱ Просрочки', callback_data: 'ae:lives:od:0' },
              { text: '❤️ Жизни', callback_data: `al:m:${studentTelegramId}` },
            ],
            [{ text: '👤 Профиль', callback_data: `admin:user:${studentTelegramId}::` }],
            [{ text: '💬 Ученик', url: `tg://user?id=${studentTelegramId}` }],
          ],
        },
      });
    } catch (err) {
      console.error('[hw-deadline] admin overdue notify failed:', err);
    }
  }
}

/**
 * Один проход cron: напоминания 12/6/2ч и overdue.
 * Не догоняет все пропущенные уровни сразу — только ближайший подходящий.
 */
export async function runHomeworkDeadlineReminders(
  admin: SupabaseClient,
  now = new Date(),
  options?: { telegramIds?: number[]; limit?: number },
): Promise<{ scanned: number; sent: number; overdue: number; errors: number }> {
  const rows = await listActiveHomeworkDeadlines(admin, options?.limit ?? 300, {
    telegramIds: options?.telegramIds,
  });
  let sent = 0;
  let overdue = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.sanity_lesson_id || !row.homework_deadline_at) continue;
    const deadline = Date.parse(row.homework_deadline_at);
    if (!Number.isFinite(deadline)) continue;
    const left = deadline - now.getTime();

    try {
      if (left <= 0) {
        await ensureOverdueMarked(admin, row.telegram_id, row.sanity_lesson_id, now);
        if (!row.hw_overdue_student_at) {
          const ok = await sendStudentReminder(admin, row, 'overdue');
          if (ok) {
            sent += 1;
            overdue += 1;
          }
        }
        if (!row.hw_overdue_curator_at) {
          const ok = await notifyCuratorOverdueOnce(admin, row.telegram_id, row.sanity_lesson_id);
          if (ok) sent += 1;
        }
        continue;
      }

      // Только один уровень за проход (не пачкой)
      if (left <= MS_2H && !row.hw_remind_2h_at) {
        if (await sendStudentReminder(admin, row, '2h')) sent += 1;
      } else if (left <= MS_6H && !row.hw_remind_6h_at && left > MS_2H) {
        if (await sendStudentReminder(admin, row, '6h')) sent += 1;
      } else if (left <= MS_12H && !row.hw_remind_12h_at && left > MS_6H) {
        if (await sendStudentReminder(admin, row, '12h')) sent += 1;
      }
    } catch (err) {
      errors += 1;
      console.error('[hw-deadline] row failed:', err);
    }
  }

  return { scanned: rows.length, sent, overdue, errors };
}

/** Ленивая проверка одного ученика (кабинет / открытие урока). Ошибки глотаем. */
export async function processHomeworkDeadlinesForStudent(
  admin: SupabaseClient,
  telegramId: number,
): Promise<void> {
  try {
    await runHomeworkDeadlineReminders(admin, new Date(), { telegramIds: [telegramId], limit: 40 });
  } catch (err) {
    console.error('[hw-deadline] student opportunistic failed:', err);
  }
}
