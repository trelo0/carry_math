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
  /** Приветствие /start — не редактируем при навигации. */
  welcomeMessageId?: number;
  /** Стек экранов для «Назад». */
  clientNavStack?: string[];
  /** Карточка пошаговой заявки. */
  leadFormMessageId?: number;
};

export const CLIENT_DIALOG_STEPS = new Set<string>([
  CLIENT_HUB_STEP,
  'client:lead-form',
  'student:support',
  'client:lesson-hw-submit',
]);

export type ClientHubState = {
  chatId: number;
  messageId: number;
};

export function hubFromState(
  state: { chat_id: number; payload: AdminPayload } | null,
): ClientHubState | null {
  if (!state) return null;
  const payload = state.payload as ClientHubPayload;
  const welcomeId = payload.welcomeMessageId;
  let messageId = payload.clientHubMessageId ?? payload.hubMessageId ?? null;
  if (messageId != null && welcomeId != null && messageId === welcomeId) {
    messageId = null;
  }
  const chatId = payload.clientHubChatId ?? state.chat_id;
  if (typeof messageId === 'number' && messageId > 0 && typeof chatId === 'number') {
    return { chatId, messageId };
  }
  return null;
}

export async function loadClientHubPayload(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ chatId: number; payload: ClientHubPayload } | null> {
  try {
    const state = await getState(admin, telegramId);
    if (!state) return null;
    return {
      chatId: state.chat_id,
      payload: (state.payload ?? {}) as ClientHubPayload,
    };
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return null;
  }
}

export function embedClientHub(payload: AdminPayload, hub: ClientHubState, screen?: string): AdminPayload {
  return {
    ...payload,
    clientHubChatId: hub.chatId,
    clientHubMessageId: hub.messageId,
    hubMessageId: hub.messageId,
    clientScreen: screen ?? (payload as ClientHubPayload).clientScreen,
  };
}

export async function saveClientDialogState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  step: ConversationStep,
  payload: AdminPayload,
): Promise<void> {
  const loaded = await loadClientHubPayload(admin, telegramId);
  const merged = loaded?.payload ? { ...loaded.payload, ...payload } : payload;
  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, step, merged);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

export async function resetClientDialogToHub(admin: SupabaseClient, telegramId: number): Promise<void> {
  let meta: ClientHubPayload | null = null;
  let chatId = 0;
  let hub: ClientHubState | null = null;
  try {
    const state = await getState(admin, telegramId);
    meta = (state?.payload ?? null) as ClientHubPayload | null;
    chatId = state?.chat_id ?? meta?.clientHubChatId ?? 0;
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
    await saveClientHub(admin, telegramId, hub, meta?.clientScreen ?? 'home', {
      welcomeMessageId: meta?.welcomeMessageId,
      clientNavStack: meta?.clientNavStack,
      leadFormMessageId: undefined,
    });
  } else if (meta?.welcomeMessageId && chatId) {
    await saveClientHub(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      'home',
      {
        welcomeMessageId: meta.welcomeMessageId,
        clientNavStack: meta.clientNavStack ?? ['home'],
      },
    );
  }
}

export async function loadClientHub(admin: SupabaseClient, telegramId: number): Promise<ClientHubState | null> {
  try {
    const state = await getState(admin, telegramId);
    const fromPayload = hubFromState(state);
    if (fromPayload) return fromPayload;
    if (!state || state.step !== CLIENT_HUB_STEP) return null;
    const payload = state.payload as ClientHubPayload;
    if (payload.welcomeMessageId && state.message_id === payload.welcomeMessageId) {
      return null;
    }
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
  extra?: Partial<ClientHubPayload>,
): Promise<void> {
  const prev = await loadClientHubPayload(admin, telegramId);
  const payload: ClientHubPayload = {
    ...(prev?.payload ?? {}),
    ...extra,
    screen,
    clientScreen: screen,
    clientHubChatId: hub.chatId || prev?.chatId,
  };
  if (hub.messageId > 0) {
    payload.hubMessageId = hub.messageId;
    payload.clientHubMessageId = hub.messageId;
  }

  const anchor = hub.messageId > 0 ? hub : { chatId: prev?.chatId ?? hub.chatId, messageId: prev?.payload.welcomeMessageId ?? 0 };

  try {
    const state = await getState(admin, telegramId);
    if (state && state.step !== CLIENT_HUB_STEP && CLIENT_DIALOG_STEPS.has(state.step)) {
      await saveState(
        admin,
        telegramId,
        { chatId: state.chat_id, messageId: state.message_id },
        state.step,
        { ...state.payload, ...payload },
      );
      return;
    }
    await saveState(admin, telegramId, anchor, CLIENT_HUB_STEP, payload);
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

/** Новая карточка внизу чата (не трогаем приветствие). */
export async function pushClientCard(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  screenId: string,
  text: string,
  keyboard: InlineKeyboard,
): Promise<number | null> {
  const prev = await loadClientHubPayload(admin, telegramId);
  const stack = ['home', screenId];
  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (!messageId) return null;
  await saveClientHub(admin, telegramId, { chatId, messageId }, screenId, {
    welcomeMessageId: prev?.payload.welcomeMessageId,
    clientNavStack: stack,
  });
  return messageId;
}

export async function editClientCard(
  admin: SupabaseClient,
  telegramId: number,
  hub: ClientHubState,
  screenId: string,
  text: string,
  keyboard: InlineKeyboard,
  navStack?: string[],
): Promise<void> {
  await editHubMessage(hub, text, keyboard);
  const prev = await loadClientHubPayload(admin, telegramId);
  await saveClientHub(admin, telegramId, hub, screenId, {
    welcomeMessageId: prev?.payload.welcomeMessageId,
    clientNavStack: navStack ?? prev?.payload.clientNavStack,
    leadFormMessageId: prev?.payload.leadFormMessageId,
  });
}

export function popNavStack(stack: string[]): { target: string; nextStack: string[] } {
  const copy = [...stack];
  if (copy.length <= 1) {
    return { target: 'home', nextStack: ['home'] };
  }
  copy.pop();
  return { target: copy[copy.length - 1] ?? 'home', nextStack: copy };
}
