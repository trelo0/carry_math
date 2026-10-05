import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { beginCourseHomeworkSubmit } from './studentHomeworkFlow';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import { beginStudentSupport } from './studentSupportFlow';
import {
  COURSE_ACTIONS,
  COURSE_DIRECTION_LABEL,
  LESSONS_ACTIONS,
  LESSONS_INDIVIDUAL_LABEL,
  LESSONS_MIXED_LABEL,
  STUDENT_BACK_LABEL,
  STUDENT_BUY_LABEL,
  STUDENT_HOME_LABEL,
} from './studentFlow';
import { resolveClientState } from './client-state';
import { handleClientMessage, refreshClientMenu } from './client-flow';
import { CLIENT_LABELS } from './client-menu';
import {
  showClientLessonsMenu,
} from './client-lessons-flow';
import { fetchNextClientLesson } from './client-lessons-data';
import { formatLessonDateTime } from '@/lib/teacher/format';
import type { BotRole } from './roles';

const LEGACY_LABELS = new Set<string>([
  STUDENT_HOME_LABEL,
  STUDENT_BUY_LABEL,
  STUDENT_BACK_LABEL,
  COURSE_DIRECTION_LABEL,
  LESSONS_INDIVIDUAL_LABEL,
  LESSONS_MIXED_LABEL,
  ...COURSE_ACTIONS,
  ...LESSONS_ACTIONS,
]);

export function isLegacyClientReplyLabel(text: string): boolean {
  return LEGACY_LABELS.has(text);
}

async function denySection(chatId: number): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: 'Раздел недоступен. Меню обновлено — используйте кнопки ниже.',
  });
}

/** Старые Reply-кнопки ученика → клиентский UI с перепроверкой доступов. */
export async function handleClientLegacyReply(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
  memberRole?: BotRole,
): Promise<boolean> {
  if (!isLegacyClientReplyLabel(text)) return false;

  const state = await resolveClientState(admin, telegramId, { memberRole });

  if (text === STUDENT_BUY_LABEL) {
    await handleClientMessage(admin, telegramId, chatId, CLIENT_LABELS.lessonsWithTeacher, memberRole);
    return true;
  }

  if (text === STUDENT_HOME_LABEL) {
    const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet');
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '👤 Личный кабинет\n\nКабинет открывается на сайте District:',
      reply_markup: { inline_keyboard: [[{ text: '🌐 Открыть личный кабинет', url }]] },
    });
    return true;
  }

  if (text === STUDENT_BACK_LABEL) {
    await refreshClientMenu(admin, telegramId, chatId, memberRole);
    return true;
  }

  if (text === COURSE_DIRECTION_LABEL) {
    if (!state.hasActiveCourse && !state.products.course) {
      await denySection(chatId);
      await refreshClientMenu(admin, telegramId, chatId, memberRole);
      return true;
    }
    await handleClientMessage(admin, telegramId, chatId, CLIENT_LABELS.onlineCourse, memberRole);
    return true;
  }

  if (text === LESSONS_INDIVIDUAL_LABEL || text === LESSONS_MIXED_LABEL) {
    if (!state.hasLessonHistory && !state.hasUpcomingLessons && !state.hasActiveLessonProduct) {
      await denySection(chatId);
      await refreshClientMenu(admin, telegramId, chatId, memberRole);
      return true;
    }
    await showClientLessonsMenu(admin, telegramId, chatId);
    return true;
  }

  if ((COURSE_ACTIONS as readonly string[]).includes(text)) {
    if (text === '📚 Сдать ДЗ ментору') {
      if (!state.hasActiveCourse) {
        await denySection(chatId);
        await refreshClientMenu(admin, telegramId, chatId, memberRole);
        return true;
      }
      await beginCourseHomeworkSubmit(admin, telegramId, chatId);
      return true;
    }
    if (text === '🆘 Получить помощь') {
      await beginStudentSupport(admin, telegramId, chatId);
      return true;
    }
    if (text === '📅 Ближайшее занятие') {
      await showClientLessonsMenu(admin, telegramId, chatId);
      return true;
    }
  }

  if ((LESSONS_ACTIONS as readonly string[]).includes(text)) {
    const hasLessons =
      state.hasLessonHistory || state.hasUpcomingLessons || state.hasActiveLessonProduct;
    if (!hasLessons) {
      await denySection(chatId);
      await refreshClientMenu(admin, telegramId, chatId, memberRole);
      return true;
    }
    if (text === '📅 Следующее занятие') {
      const next = await fetchNextClientLesson(admin, telegramId);
      if (!next) {
        await telegramSend('sendMessage', {
          chat_id: chatId,
          text: '📅 Ближайших занятий пока нет.',
        });
        return true;
      }
      const { date, time } = formatLessonDateTime(next.startsAt);
      const lines = [
        '📅 Ближайшее занятие',
        '',
        next.topic,
        `${date} ${time}`,
      ];
      if (next.meetUrl) lines.push(`🔗 ${next.meetUrl}`);
      await telegramSend('sendMessage', { chat_id: chatId, text: lines.join('\n') });
      return true;
    }
    if (text === '💬 Задать вопрос наставнику') {
      await beginStudentMentorQuestion(admin, telegramId, chatId);
      return true;
    }
    if (text === '📝 Сдать домашку') {
      await showClientLessonsMenu(admin, telegramId, chatId);
      return true;
    }
  }

  return false;
}
