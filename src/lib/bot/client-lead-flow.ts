import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { normalizePhone } from '@/lib/phone';
import {
  getState,
  isConversationStateTableError,
  sendAdminMessage,
  type AdminPayload,
} from './admin/core';
import {
  clientHomeButton,
  editHubMessage,
  loadClientHub,
  resetClientDialogToHub,
  saveClientDialogState,
  saveClientHub,
  sendHubMessage,
} from './client-nav';
import {
  isLeadStatusColumnError,
  LEAD_SELECT_COLUMNS,
  notifyAdminsOfNewLead,
  type LeadRow,
} from './admin/leads';

export const CLIENT_LEAD_FORM_STEP = 'client:lead-form' as const;

export type LeadFormat = 'individual' | 'group';

type LeadFormStep = 'name' | 'grade' | 'wishes' | 'contact' | 'confirm';

export type LeadFormPayload = AdminPayload & {
  leadFormat?: LeadFormat;
  leadStudentName?: string;
  leadGrade?: string;
  leadWishes?: string;
  leadContact?: string;
  leadStep?: LeadFormStep;
  leadSubmittedAt?: string;
  leadSubmitting?: boolean;
};

const FORMAT_LABEL: Record<LeadFormat, string> = {
  individual: 'Индивидуальные занятия',
  group: 'Групповые занятия',
};

const TELEGRAM_ID_TAG = (id: number) => `telegram_id:${id}`;

function formatLabel(format: LeadFormat): string {
  return FORMAT_LABEL[format];
}

async function findRecentDuplicateLead(
  admin: SupabaseClient,
  telegramId: number,
  format: LeadFormat,
): Promise<boolean> {
  const tag = TELEGRAM_ID_TAG(telegramId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .eq('source', 'telegram_bot')
    .eq('service', formatLabel(format))
    .gte('created_at', since)
    .ilike('comment', `%${tag}%`)
    .eq('status', 'new')
    .limit(1);
  if (error && isLeadStatusColumnError(error)) {
    const fallback = await admin
      .from('leads')
      .select('id')
      .eq('source', 'telegram_bot')
      .eq('service', formatLabel(format))
      .gte('created_at', since)
      .ilike('comment', `%${tag}%`)
      .limit(1);
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []).length > 0;
  }
  if (error) throw error;
  return (data ?? []).length > 0;
}


async function showLeadFormatHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const text =
    '📝 Заявка на занятия\n\n' +
    'Выберите формат обучения. Дальше бот задаст несколько коротких вопросов — заявку можно отправить ученику или родителю.';
  const keyboard = {
    inline_keyboard: [
      [{ text: '📚 Индивидуальные занятия', callback_data: 'cl:lead:fmt:individual' }],
      [{ text: '👥 Групповые занятия', callback_data: 'cl:lead:fmt:group' }],
      [clientHomeButton()],
    ],
  };

  const hub = await loadClientHub(admin, telegramId);
  if (hub) {
    const ok = await editHubMessage(hub, text, keyboard);
    if (ok) {
      await saveClientHub(admin, telegramId, hub, 'lead-format');
      return;
    }
  }
  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (messageId) await saveClientHub(admin, telegramId, { chatId, messageId }, 'lead-format');
}

export async function beginClientLeadForm(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options?: { format?: LeadFormat },
): Promise<void> {
  if (options?.format) {
    const payload: LeadFormPayload = { leadFormat: options.format };
    await persistLeadFormState(admin, telegramId, chatId, payload, 'name');
    const hub = await loadClientHub(admin, telegramId);
    if (hub) await saveClientHub(admin, telegramId, hub, 'lead-form');
    await askNextQuestion(chatId, 'name');
    return;
  }
  await showLeadFormatHub(admin, telegramId, chatId);
}

function confirmSummary(payload: LeadFormPayload): string {
  const format = payload.leadFormat!;
  return [
    '📝 Проверьте заявку',
    '',
    `Формат: ${formatLabel(format)}`,
    `Имя ученика: ${payload.leadStudentName}`,
    `Класс: ${payload.leadGrade}`,
    payload.leadWishes?.trim() ? `Пожелания: ${payload.leadWishes.trim()}` : 'Пожелания: не указаны',
    payload.leadContact?.trim()
      ? `Контакт: ${payload.leadContact.trim()}`
      : 'Контакт: не указан (связь через Telegram)',
  ].join('\n');
}

async function showConfirmHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: LeadFormPayload,
): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ Отправить заявку', callback_data: 'cl:lead:submit' }],
      [{ text: '✏️ Изменить данные', callback_data: 'cl:lead:edit' }],
      [{ text: '❌ Отменить', callback_data: 'cl:lead:cancel' }],
      [clientHomeButton()],
    ],
  };
  const hub = await loadClientHub(admin, telegramId);
  const text = confirmSummary(payload);
  if (hub) {
    await editHubMessage(hub, text, keyboard);
    await saveClientHub(admin, telegramId, hub, 'lead-confirm');
    return;
  }
  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (messageId) await saveClientHub(admin, telegramId, { chatId, messageId }, 'lead-confirm');
}

async function persistLeadFormState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: LeadFormPayload,
  step: LeadFormStep,
): Promise<void> {
  await saveClientDialogState(admin, telegramId, chatId, CLIENT_LEAD_FORM_STEP, {
    ...payload,
    leadStep: step,
  });
}

async function askNextQuestion(chatId: number, step: LeadFormStep): Promise<void> {
  const prompts: Record<LeadFormStep, string> = {
    name: 'Как зовут ученика? (имя или имя и фамилия)\n\nОтмена — напишите «Отмена».',
    grade: 'В каком классе учится? (например: 9, 10, 11)\n\nОтмена — «Отмена».',
    wishes:
      'Цель занятий и пожелания (необязательно).\n' +
      'Можно написать «Пропустить» или «Отмена».',
    contact:
      'Контакт для связи — телефон или другой способ (необязательно).\n' +
      'Можно «Пропустить» или «Отмена».',
    confirm: '',
  };
  if (prompts[step]) await sendAdminMessage(chatId, prompts[step]);
}

export function isClientLeadCallback(data: string): boolean {
  return data.startsWith('cl:lead:');
}

export async function handleClientLeadCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientLeadCallback(data)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (data === 'cl:lead:cancel') {
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Заявка отменена.');
    await saveClientHub(admin, telegramId, { chatId, messageId }, 'lead-cancelled');
    return true;
  }

  if (data.startsWith('cl:lead:fmt:')) {
    const format = data.slice('cl:lead:fmt:'.length) as LeadFormat;
    if (format !== 'individual' && format !== 'group') return true;

    const payload: LeadFormPayload = { leadFormat: format };
    await persistLeadFormState(admin, telegramId, chatId, payload, 'name');
    await saveClientHub(admin, telegramId, { chatId, messageId }, 'lead-form');
    await askNextQuestion(chatId, 'name');
    return true;
  }

  if (data === 'cl:lead:skip:contact') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = { ...(state.payload as LeadFormPayload), leadContact: '' };
    await persistLeadFormState(admin, telegramId, chatId, payload, 'confirm');
    await showConfirmHub(admin, telegramId, chatId, payload);
    return true;
  }

  if (data === 'cl:lead:edit') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = state.payload as LeadFormPayload;
    await persistLeadFormState(admin, telegramId, chatId, payload, 'name');
    await askNextQuestion(chatId, 'name');
    return true;
  }

  if (data === 'cl:lead:submit') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = state.payload as LeadFormPayload;
    if (payload.leadSubmittedAt || payload.leadSubmitting) {
      await sendAdminMessage(chatId, 'Заявка уже отправлена. Администратор свяжется с вами.');
      return true;
    }

    if (!payload.leadFormat || !payload.leadStudentName || !payload.leadGrade) {
      await sendAdminMessage(chatId, 'Заявка неполная. Начните заново через «Оставить заявку на занятия».');
      await resetClientDialogToHub(admin, telegramId);
      return true;
    }

    if (await findRecentDuplicateLead(admin, telegramId, payload.leadFormat)) {
      await resetClientDialogToHub(admin, telegramId);
      const text =
        '⏳ Похожая заявка уже отправлена недавно.\n\n' +
        'Администратор свяжется с вами. Если нужно уточнить данные — напишите через «Связаться с администратором».';
      const hub = await loadClientHub(admin, telegramId);
      if (hub) await editHubMessage(hub, text, { inline_keyboard: [[clientHomeButton()]] });
      else await sendHubMessage(chatId, text, { inline_keyboard: [[clientHomeButton()]] });
      return true;
    }

    const contactRaw = payload.leadContact?.trim();
    const contact =
      contactRaw && contactRaw.length > 0
        ? contactRaw
        : `Telegram (ID ${telegramId})`;

    await persistLeadFormState(admin, telegramId, chatId, { ...payload, leadSubmitting: true }, 'confirm');

    const wishesBlock = payload.leadWishes?.trim() || null;
    const comment = [wishesBlock, TELEGRAM_ID_TAG(telegramId)].filter(Boolean).join('\n\n');

    const insertRow: Record<string, unknown> = {
      name: payload.leadStudentName.trim(),
      contact,
      grade: payload.leadGrade.trim(),
      comment,
      service: formatLabel(payload.leadFormat),
      source: 'telegram_bot',
    };

    const { data: inserted, error } = await admin
      .from('leads')
      .insert(insertRow)
      .select(LEAD_SELECT_COLUMNS)
      .maybeSingle();
    if (error) {
      if (String(error.message ?? '').includes('assigned_telegram_id')) {
        const fallback = await admin.from('leads').insert(insertRow).select('id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status').single();
        if (fallback.error) throw fallback.error;
        await notifyAdminsOfNewLead(admin, fallback.data as LeadRow);
      } else throw error;
    } else if (inserted) {
      await notifyAdminsOfNewLead(admin, inserted as LeadRow);
    }

    await resetClientDialogToHub(admin, telegramId);

    const successText =
      '✅ Заявка отправлена.\n\n' +
      'Администратор свяжется с вами для уточнения деталей, расписания и оплаты.';
    const keyboard = {
      inline_keyboard: [
        [clientHomeButton()],
        [{ text: '💬 Связаться с администратором', callback_data: 'cl:lead:goto:support' }],
      ],
    };
    await editHubMessage({ chatId, messageId }, successText, keyboard);
    await saveClientHub(admin, telegramId, { chatId, messageId }, 'lead-done');
    return true;
  }

  if (data === 'cl:lead:goto:support') {
    const { beginStudentSupport } = await import('./studentSupportFlow');
    await beginStudentSupport(admin, telegramId, chatId);
    return true;
  }

  return false;
}

export async function handleClientLeadMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return false;

  const payload = { ...(state.payload as LeadFormPayload) };
  const step = payload.leadStep ?? 'name';
  const trimmed = text.trim();

  if (/^отмена$/i.test(trimmed)) {
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Заявка отменена.');
    return true;
  }

  if (step === 'name') {
    if (trimmed.length < 2) {
      await sendAdminMessage(chatId, 'Укажите имя ученика (минимум 2 символа).');
      return true;
    }
    payload.leadStudentName = trimmed;
    await persistLeadFormState(admin, telegramId, chatId, payload, 'grade');
    await askNextQuestion(chatId, 'grade');
    return true;
  }

  if (step === 'grade') {
    if (trimmed.length < 1) {
      await sendAdminMessage(chatId, 'Укажите класс (например: 10).');
      return true;
    }
    payload.leadGrade = trimmed;
    await persistLeadFormState(admin, telegramId, chatId, payload, 'wishes');
    await askNextQuestion(chatId, 'wishes');
    return true;
  }

  if (step === 'wishes') {
    if (!/^пропустить$/i.test(trimmed)) {
      payload.leadWishes = trimmed;
    } else {
      payload.leadWishes = '';
    }
    await persistLeadFormState(admin, telegramId, chatId, payload, 'contact');
    await sendAdminMessage(
      chatId,
      'Контакт для связи (необязательно). Отправьте номер или нажмите «Пропустить» в сообщении ниже.',
      {
        inline_keyboard: [[{ text: 'Пропустить', callback_data: 'cl:lead:skip:contact' }]],
      },
    );
    return true;
  }

  if (step === 'contact') {
    if (!/^пропустить$/i.test(trimmed)) {
      const phone = normalizePhone(trimmed);
      payload.leadContact = phone ?? trimmed;
    } else {
      payload.leadContact = '';
    }
    await persistLeadFormState(admin, telegramId, chatId, payload, 'confirm');
    await showConfirmHub(admin, telegramId, chatId, payload);
    return true;
  }

  return false;
}
