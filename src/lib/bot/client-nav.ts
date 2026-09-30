import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearState,
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  type AdminPayload,
  type ConversationStep,
} from './admin/core';

export const CLIENT_HUB_STEP = 'client:hub' as const;

export type ClientHubPayload = AdminPayload & {
  hubMessageId?: number;
  screen?: string;
  clientHubChatId?: number;
  clientHubMessageId?: number;
  clientScreen?: string;
};

const CLIENT_DIALOG_STEPS = new Set<string>([
  CLIENT_HUB_STEP,
  'client:lead-form',
  'student:support',
  'client:lesson-hw-submit',
]);

export function hubFromState(
  state: { chat_id: number; payload: AdminPayload } | null,
): ClientHubState | null {
  if (!state) return null;
  const payload = state.payload as ClientHubPayload;
  const messageId = payload.clientHubMessageId ?? payload.hubMessageId ?? null;
  const chatId = payload.clientHubChatId ?? state.chat_id;
  if (typeof messageId === 'number' && messageId > 0 && typeof chatId === 'number') {
    return { chatId, messageId };
  }
  return null;
}

export function embedClientHub(payload: AdminPayload, hub: ClientHubState, screen?: string): AdminPayload {
  return {
    ...payload,
    clientHubChatId: hub.chatId,
    clientHubMessageId: hub.messageId,
    clientScreen: screen ?? (payload as ClientHubPayload).clientScreen,
  };
}

/** Сохранить шаг диалога, не теряя ссылку на hub-сообщение. */
export async function saveClientDialogState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  step: ConversationStep,
  payload: AdminPayload,
): Promise<void> {
  const hub = await loadClientHub(admin, telegramId);
  const merged = hub ? embedClientHub(payload, hub) : payload;
  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, step, merged);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

/** Завершить lead/support/hw и вернуть состояние к hub. */
export async function resetClientDialogToHub(admin: SupabaseClient, telegramId: number): Promise<void> {
  let hub: ClientHubState | null = null;
  try {
    const state = await getState(admin, telegramId);
    hub = hubFromState(state);
    if (state?.step === CLIENT_HUB_STEP) {
      return;
    }
    if (state && !CLIENT_DIALOG_STEPS.has(state.step)) {
      return;
    }
    await clearState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return;
  }
  if (hub) {
    await saveClientHub(admin, telegramId, hub, 'home');
  }
}

export type ClientHubState = {
  chatId: number;
  messageId: number;
};

export async function loadClientHub(admin: SupabaseClient, telegramId: number): Promise<ClientHubState | null> {
  try {
    const state = await getState(admin, telegramId);
    const fromPayload = hubFromState(state);
    if (fromPayload) return fromPayload;
    if (!state || state.step !== CLIENT_HUB_STEP) return null;
    const messageId = state.message_id;
    if (!messageId) return null;
    return { chatId: state.chat_id, messageId };
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return null;
  }
}

export async function saveClientHub(
  admin: SupabaseClient,
  telegramId: number,
  hub: ClientHubState,
  screen: string,
): Promise<void> {
  const payload: ClientHubPayload = {
    hubMessageId: hub.messageId,
    screen,
    clientHubChatId: hub.chatId,
    clientHubMessageId: hub.messageId,
    clientScreen: screen,
  };
  try {
    const state = await getState(admin, telegramId);
    if (state && state.step !== CLIENT_HUB_STEP && CLIENT_DIALOG_STEPS.has(state.step)) {
      await saveState(
        admin,
        telegramId,
        { chatId: state.chat_id, messageId: state.message_id },
        state.step,
        embedClientHub(state.payload, hub, screen),
      );
      return;
    }
    await saveState(admin, telegramId, hub, CLIENT_HUB_STEP, payload);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

export async function clearClientHub(admin: SupabaseClient, telegramId: number): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
}

type InlineKeyboard = { inline_keyboard: Array<Array<Record<string, string>>> };

export async function editHubMessage(
  hub: ClientHubState,
  text: string,
  replyMarkup: InlineKeyboard,
): Promise<boolean> {
  const result = await telegramSend('editMessageText', {
    chat_id: hub.chatId,
    message_id: hub.messageId,
    text,
    reply_markup: replyMarkup,
  });
  if (result.ok) return true;
  if (result.description?.includes('message is not modified')) return true;
  return false;
}

export async function sendHubMessage(
  chatId: number,
  text: string,
  replyMarkup: InlineKeyboard,
): Promise<number | null> {
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
  if (!result.ok) throw new Error(result.description ?? 'Не удалось отправить экран навигации.');
  return result.result?.message_id ?? null;
}

export function clientHomeButton() {
  return { text: '🏠 Главное меню', callback_data: 'cl:home' };
}

export function clientBackButton() {
  return { text: '◀️ Назад', callback_data: 'cl:back' };
}
