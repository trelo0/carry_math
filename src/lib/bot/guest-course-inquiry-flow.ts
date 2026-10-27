import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from './admin/core';
import { notifyPrimaryAdminMainChatInbox } from './admin/admin-guest-inbox';
import { getCoursePaymentOfferBySlug } from '@/lib/studio/courseContent';
import { clientBackButton, resetClientDialogToHub, saveClientDialogState } from './client-nav';
import { isClientReplyLabel } from './client-menu';
import { createInquiryLead } from './inquiry-leads';

export const GUEST_COURSE_INQUIRY_STEP = 'guest:course-inquiry' as const;
export const GUEST_COURSE_INQUIRY_CONFIRM = 'guest:course-inquiry-confirm' as const;

const CANCEL_CB = 'cl:guest:course:ask:cancel';
const SEND_CB = 'cl:guest:course:ask:send';
const EDIT_CB = 'cl:guest:course:ask:edit';

function cancelKeyboard() {
  return {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: CANCEL_CB }]],
  };
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Отправить', callback_data: SEND_CB }],
      [
        { text: '✏️ Изменить', callback_data: EDIT_CB },
        { text: '◀️ Назад', callback_data: CANCEL_CB },
      ],
    ],
  };
}

export function formatGuestCourseInquiryBody(courseTitle: string, userText: string): string {
  return `[Курс: ${courseTitle}]\n\n${userText.trim()}`;
}

export function parseCourseTitleFromInquiryBody(body: string): string | undefined {
  const m = body.match(/^\[Курс: (.+)\]/);
  return m?.[1]?.trim();
}

export async function beginGuestCourseInquiry(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseSlug: string,
): Promise<void> {
  const offer = await getCoursePaymentOfferBySlug(courseSlug);
  const title = offer?.title ?? courseSlug;
  try {
    await saveClientDialogState(admin, telegramId, chatId, GUEST_COURSE_INQUIRY_STEP, {
      guestCourseSlug: courseSlug,
      guestCourseTitle: title,
    } as never);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(
    chatId,
    [
      `📚 Узнать больше о курсе`,
      '',
      offer?.title ?? title,
      '',
      'Напишите свой вопрос администратору — текст, фото или документ.',
      '',
      'Мы ответим в Telegram.',
    ].join('\n'),
    cancelKeyboard(),
  );
}

async function showPreview(chatId: number, draft: string, hasFile: boolean): Promise<void> {
  const lines = [
    '📋 Предпросмотр',
    '',
    draft.trim() || '(без текста)',
    hasFile ? '\n📎 Вложение будет отправлено' : '',
    '',
    'Отправить администратору?',
  ].filter(Boolean);
  await sendAdminMessage(chatId, lines.join('\n'), confirmKeyboard());
}

async function dispatchInquiry(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const title = String(payload.guestCourseTitle ?? 'Курс');
  const slug = String(payload.guestCourseSlug ?? '');
  const rawDraft = String(payload.draftText ?? '').trim() || 'Вопрос о курсе';
  const fullBody = formatGuestCourseInquiryBody(title, rawDraft);

  const draftFileRef = payload.draftFileRef as string | undefined;
  const draftFileKind = payload.draftFileKind as 'photo' | 'document' | 'voice' | undefined;
  const attachment =
    draftFileRef && draftFileRef.startsWith('tg:')
      ? { ref: draftFileRef, kind: draftFileKind ?? ('document' as const) }
      : undefined;

  await createInquiryLead(admin, telegramId, 'guest_question', fullBody, {
    forceNew: true,
    firstAttachment: attachment
      ? {
          fileId: attachment.ref.slice(3),
          kind: attachment.kind,
        }
      : undefined,
  });

  await notifyPrimaryAdminMainChatInbox(admin, telegramId, {
    kind: 'course_inquiry',
    header: '📚 Вопрос о курсе',
    body: fullBody,
    courseTitle: title,
    attachmentRef: attachment?.ref,
    attachmentKind: attachment?.kind,
  });

  await clearStateIfAvailable(admin, telegramId);
  await sendAdminMessage(
    chatId,
    '✅ Вопрос отправлен администратору.\n\nОтвет придёт в этот чат с ботом.',
    { inline_keyboard: [[clientBackButton()]] },
  );
}

export async function handleGuestCourseInquiryCallback(
  admin: SupabaseClient,
  data: string,
  telegramId: number,
  chatId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const isAsk =
    data.startsWith('cl:guest:course:ask:') &&
    data !== CANCEL_CB &&
    data !== SEND_CB &&
    data !== EDIT_CB;
  if (!isAsk && data !== CANCEL_CB && data !== SEND_CB && data !== EDIT_CB) {
    return false;
  }

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (isAsk) {
    const slug = data.slice('cl:guest:course:ask:'.length);
    if (slug) {
      await beginGuestCourseInquiry(admin, telegramId, chatId, slug);
      return true;
    }
  }

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return true;
  }

  if (data === CANCEL_CB) {
    const slug = (state?.payload as { guestCourseSlug?: string } | undefined)?.guestCourseSlug;
    await clearStateIfAvailable(admin, telegramId);
    if (slug) {
      const { resolveClientState } = await import('./client-state');
      const clientState = await resolveClientState(admin, telegramId, {});
      const { showGuestCourseOfferScreen } = await import('./client-flow');
      await showGuestCourseOfferScreen(admin, clientState, slug, {
        kind: 'push',
        chatId,
      });
      return true;
    }
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Отменено.', {
      inline_keyboard: [[clientBackButton()]],
    });
    return true;
  }

  if (!state) return false;

  if (data === EDIT_CB && state.step === GUEST_COURSE_INQUIRY_CONFIRM) {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, GUEST_COURSE_INQUIRY_STEP, {
      ...state.payload,
    } as never);
    await sendAdminMessage(chatId, 'Измените текст или вложение.', cancelKeyboard());
    return true;
  }

  if (data === SEND_CB && state.step === GUEST_COURSE_INQUIRY_CONFIRM) {
    await dispatchInquiry(admin, telegramId, chatId, state.payload as Record<string, unknown>);
    return true;
  }

  return false;
}

export async function handleGuestCourseInquiryMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (isClientReplyLabel(text)) return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== GUEST_COURSE_INQUIRY_STEP) return false;

  const trimmed = text.trim();
  if (!trimmed) {
    await sendAdminMessage(chatId, 'Напишите текст или отправьте файл.');
    return true;
  }

  await saveState(admin, telegramId, { chatId, messageId: 0 }, GUEST_COURSE_INQUIRY_CONFIRM, {
    ...state.payload,
    draftText: trimmed,
  });
  await showPreview(chatId, trimmed, Boolean(state.payload.draftFileRef));
  return true;
}

export async function handleGuestCourseInquiryAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
  attachment: { fileId: string; kind: 'photo' | 'document' | 'voice' },
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== GUEST_COURSE_INQUIRY_STEP) return false;

  const body =
    caption.trim() ||
    (attachment.kind === 'voice' ? 'Голосовое сообщение' : 'Вложение к вопросу о курсе');

  await saveState(admin, telegramId, { chatId, messageId: 0 }, GUEST_COURSE_INQUIRY_CONFIRM, {
    ...state.payload,
    draftText: body,
    draftFileRef: `tg:${attachment.fileId}`,
    draftFileKind: attachment.kind,
  } as never);
  await showPreview(chatId, body, true);
  return true;
}
