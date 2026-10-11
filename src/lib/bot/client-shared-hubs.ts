import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { beginStudentSupport } from './studentSupportFlow';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import {
  clientHomeButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
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
    '💳 Оплаты',
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
        ...(state.hasActiveLessonProduct || state.hasLessonHistory
          ? [[{ text: '📦 Остаток пакета занятий', callback_data: 'cl:pay:pkg' }]]
          : []),
        [{ text: '🎓 Купить / продлить обучение', callback_data: 'cl:buy:hub' }],
        [{ text: '🧾 История оплат', callback_data: 'cl:pay:hist' }],
        [clientHomeButton()],
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
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'misc-hub',
    '⋯ Прочее\n\nИстория, заявки и связь с администратором.',
    {
      inline_keyboard: [
        [{ text: '🧾 История оплат', callback_data: 'cl:misc:hist' }],
        [{ text: '📨 История заявок', callback_data: 'cl:misc:apps' }],
        [{ text: '💬 Связаться с администратором', callback_data: 'cl:misc:admin' }],
        [clientHomeButton()],
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
  rows.push([clientHomeButton()]);

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
    await showClientPurchaseHistory(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:misc:apps') {
    await showClientApplicationsHub(admin, telegramId, chatId, { editAt });
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
    await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'course' });
    return true;
  }

  return false;
}
