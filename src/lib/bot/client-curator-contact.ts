import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { listStudentPurchasedVisibleCourseContexts } from './education/student-course-context';
import { listStudentCourseStaffThreads } from './staff/messaging';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import {
  clientBackButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import { buildClientReplyKeyboard } from './client-menu';
import { resolveClientState } from './client-state';
import { formatDateTimeShort } from './client-format';

export function isClientCuratorContactCallback(data: string): boolean {
  return data.startsWith('cl:cur:');
}

export async function openCuratorContactFlow(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (enrollments.length === 0) {
    const state = await resolveClientState(admin, telegramId);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Раздел доступен после подключения онлайн-курса.',
      reply_markup: buildClientReplyKeyboard(state),
    });
    return;
  }
  if (enrollments.length === 1) {
    await showCuratorCourseContactHub(admin, telegramId, chatId, enrollments[0]!.courseId, deliver);
    return;
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'curator-pick-course',
    '💬 Связаться с куратором\n\nВыберите курс:',
    {
      inline_keyboard: [
        ...enrollments.map((c) => [
          { text: c.title.slice(0, 58), callback_data: `cl:cur:hub:${c.courseId}` },
        ]),
        [clientBackButton()],
      ],
    },
    deliver,
  );
}

export async function showCuratorCourseContactHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const courseTitle = enrollments.find((e) => e.courseId === courseId)?.title?.trim();

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `curator-hub:${courseId}`,
    [
      '💬 Куратор курса',
      courseTitle ? `🎓 ${courseTitle}` : null,
      '',
      'Напишите куратору или посмотрите историю обращений.',
    ]
      .filter(Boolean)
      .join('\n'),
    {
      inline_keyboard: [
        [{ text: '✉️ Связаться', callback_data: `cl:cur:write:${courseId}` }],
        [{ text: '📨 Мои обращения', callback_data: `cl:cur:app:${courseId}` }],
        [clientBackButton()],
      ],
    },
    deliver,
  );
}

async function showCuratorAppealsMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `curator-apps:${courseId}`,
    '📨 Мои обращения\n\nНовые — ждут ответа или свежие ответы куратора. Архив — вся переписка.',
    {
      inline_keyboard: [
        [{ text: '🆕 Новые', callback_data: `cl:cur:appn:${courseId}` }],
        [{ text: '📁 Архив', callback_data: `cl:cur:appa:${courseId}` }],
        [{ text: '◀️ Назад', callback_data: `cl:cur:hub:${courseId}` }],
      ],
    },
    deliver,
  );
}

async function showCuratorAppealsList(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseId: number,
  mode: 'new' | 'arch',
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const { threads, storageEnabled } = await listStudentCourseStaffThreads(
    admin,
    telegramId,
    courseId,
  );
  if (!storageEnabled) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'История обращений пока недоступна.',
    });
    return;
  }

  const filtered =
    mode === 'new'
      ? threads.filter((t) => t.waitingReply || t.lastDirection === 'staff_to_student')
      : threads;

  const lines =
    mode === 'new'
      ? ['🆕 Новые обращения', '']
      : ['📁 Архив обращений', ''];

  if (filtered.length === 0) {
    lines.push(mode === 'new' ? 'Нет новых сообщений.' : 'Пока нет переписки с куратором.');
  } else {
    for (const t of filtered.slice(0, 12)) {
      const who = t.lastDirection === 'staff_to_student' ? 'Куратор' : 'Вы';
      lines.push(`${who} · ${formatDateTimeShort(t.lastAt)}`);
      lines.push(t.lastBody.slice(0, 200));
      lines.push('');
    }
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `curator-app-${mode}:${courseId}`,
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: `cl:cur:app:${courseId}` }]],
    },
    deliver,
  );
}

export async function handleClientCuratorContactCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientCuratorContactCallback(data)) return false;
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  const editAt = { chatId, messageId };
  const courseId = Number(data.split(':')[3]);

  if (data.startsWith('cl:cur:hub:')) {
    await showCuratorCourseContactHub(admin, telegramId, chatId, courseId, { editAt });
    return true;
  }
  if (data.startsWith('cl:cur:appn:')) {
    await showCuratorAppealsList(admin, telegramId, chatId, courseId, 'new', { editAt });
    return true;
  }
  if (data.startsWith('cl:cur:appa:')) {
    await showCuratorAppealsList(admin, telegramId, chatId, courseId, 'arch', { editAt });
    return true;
  }
  if (data.startsWith('cl:cur:app:')) {
    await showCuratorAppealsMenu(admin, telegramId, chatId, courseId, { editAt });
    return true;
  }
  if (data.startsWith('cl:cur:write:')) {
    const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    const slug = enrollments.find((e) => e.courseId === courseId)?.slug;
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseId,
      courseSlug: slug,
    });
    return true;
  }

  return false;
}
