import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { beginStudentSupport } from './studentSupportFlow';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import {
  clientBackButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import { listStudentPurchasedVisibleCourseContexts } from './education/student-course-context';
import { showClientPackageMenu } from './client-lessons-flow';
import { showClientPurchaseHistory } from './client-purchase-history';
import { showClientApplicationsHub } from './client-my-leads';
import { buildClientReplyKeyboard } from './client-menu';
import { resolveClientState } from './client-state';

export async function showClientPaymentsHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  const lines = [
    '💳 Финансы',
    '',
    state.hasActiveLessonProduct
      ? 'Здесь остаток пакета занятий и продление / покупка другого формата.'
      : 'Можно купить курс или пакет занятий с преподавателем.',
  ];

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'payments-hub',
    lines.join('\n'),
    {
      inline_keyboard: [
        ...(state.hasActiveLessonProduct ||
        state.hasActiveCourse ||
        state.hasLessonHistory
          ? [[{ text: '📦 Остаток пакетов', callback_data: 'cl:pay:pkg' }]]
          : []),
        [{ text: '🎓 Купить / продлить обучение', callback_data: 'cl:buy:hub' }],
        [{ text: '🧾 История оплат', callback_data: 'cl:pay:hist' }],
        [clientBackButton()],
      ],
    },
    deliver,
  );
}

export async function showClientMiscHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'misc-hub',
    '🆘 Получить помощь\n\nЗаявки к администратору и поддержка.',
    {
      inline_keyboard: [
        [{ text: '💬 Связаться с администратором', callback_data: 'cl:misc:admin' }],
        ...(state.hasActiveCourse
          ? [[{ text: '🎓 Связаться с куратором по курсу', callback_data: 'cl:misc:curator' }]]
          : []),
        ...(state.hasActiveLessonProduct
          ? [[{ text: '👨‍🏫 Связаться с преподавателем', callback_data: 'cl:misc:teacher' }]]
          : []),
        [clientBackButton()],
      ],
    },
    deliver,
  );
}

export async function showClientContactHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  const rows: Array<Array<Record<string, string>>> = [];
  if (state.hasActiveLessonProduct) {
    rows.push([{ text: '👨‍🏫 Задать вопрос преподавателю', callback_data: 'cl:contact:teacher' }]);
  }
  if (state.hasActiveCourse) {
    rows.push([{ text: '🎓 Связаться с куратором курса', callback_data: 'cl:contact:curator' }]);
  }
  rows.push([clientBackButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'contact-hub',
    '💬 Связь\n\nВыберите, с кем связаться:',
    { inline_keyboard: rows },
    deliver,
  );
}

export function isClientSharedHubCallback(data: string): boolean {
  return (
    data.startsWith('cl:pay:') ||
    data.startsWith('cl:misc:') ||
    data.startsWith('cl:contact:')
  );
}

export async function handleClientSharedHubCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientSharedHubCallback(data)) return false;
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  const editAt = { chatId, messageId };
  const state = await resolveClientState(admin, telegramId);

  if (data === 'cl:pay:pkg') {
    await showClientPackageMenu(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:pay:hist' || data === 'cl:misc:hist') {
    // cl:misc:hist — совместимость со старыми кнопками
    await showClientPurchaseHistory(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:misc:curator') {
    const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    if (courses.length === 1) {
      await beginStudentMentorQuestion(admin, telegramId, chatId, {
        context: 'course',
        courseId: courses[0]!.courseId,
        courseSlug: courses[0]!.slug,
      });
    } else if (courses.length > 1) {
      await deliverClientHubScreen(
        admin,
        telegramId,
        chatId,
        'misc-curator-pick',
        '🎓 Выберите курс:',
        {
          inline_keyboard: [
            ...courses.map((c) => [
              { text: c.title.slice(0, 58), callback_data: `cl:misc:cur:${c.courseId}` },
            ]),
            [clientBackButton()],
          ],
        },
        { editAt },
      );
    }
    return true;
  }
  if (data.startsWith('cl:misc:cur:')) {
    const courseId = Number(data.slice('cl:misc:cur:'.length));
    const { listStudentPurchasedVisibleCourseContexts } = await import(
      './education/student-course-context'
    );
    const hit = (await listStudentPurchasedVisibleCourseContexts(admin, telegramId)).find(
      (c) => c.courseId === courseId,
    );
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseId,
      courseSlug: hit?.slug,
    });
    return true;
  }
  if (data === 'cl:misc:teacher') {
    await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'lessons' });
    return true;
  }
  if (data === 'cl:misc:admin') {
    await beginStudentSupport(admin, telegramId, chatId);
    return true;
  }
  if (data === 'cl:contact:teacher') {
    if (!state.hasActiveLessonProduct) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Раздел доступен при активных занятиях с преподавателем.',
        reply_markup: buildClientReplyKeyboard(state),
      });
      return true;
    }
    await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'lessons' });
    return true;
  }
  if (data === 'cl:contact:curator') {
    if (!state.hasActiveCourse) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Раздел доступен после подключения онлайн-курса.',
        reply_markup: buildClientReplyKeyboard(state),
      });
      return true;
    }
    const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    if (courses.length === 1) {
      await beginStudentMentorQuestion(admin, telegramId, chatId, {
        context: 'course',
        courseId: courses[0]!.courseId,
        courseSlug: courses[0]!.slug,
      });
    } else if (courses.length > 1) {
      await deliverClientHubScreen(
        admin,
        telegramId,
        chatId,
        'contact-curator-pick',
        '🎓 Выберите курс:',
        {
          inline_keyboard: [
            ...courses.map((c) => [
              { text: c.title.slice(0, 58), callback_data: `cl:contact:cur:${c.courseId}` },
            ]),
            [clientBackButton()],
          ],
        },
        { editAt: { chatId, messageId } },
      );
    }
    return true;
  }
  if (data.startsWith('cl:contact:cur:')) {
    const courseId = Number(data.slice('cl:contact:cur:'.length));
    const hit = (await listStudentPurchasedVisibleCourseContexts(admin, telegramId)).find(
      (c) => c.courseId === courseId,
    );
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseId,
      courseSlug: hit?.slug,
    });
    return true;
  }

  return false;
}
