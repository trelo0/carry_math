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
  clientBackButton,
  loadClientHubPayload,
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
  /** Последнее сообщение бота с кнопками шага (не редактируем — только снимаем клавиатуру). */
  leadFormMessageId?: number;
};

const FORMAT_LABEL: Record<LeadFormat, string> = {
  individual: 'Индивидуальные занятия',
  group: 'Групповые занятия',
};

const TELEGRAM_ID_TAG = (id: number) => `telegram_id:${id}`;

const STEP_ORDER: LeadFormStep[] = ['name', 'grade', 'wishes', 'contact', 'confirm'];

function formatLabel(format: LeadFormat): string {
  return FORMAT_LABEL[format];
}

function previousStep(step: LeadFormStep): LeadFormStep | null {
  const i = STEP_ORDER.indexOf(step);
  if (i <= 0) return null;
  return STEP_ORDER[i - 1] ?? null;
}

function stepPrompt(step: LeadFormStep): string {
  switch (step) {
    case 'name':
      return 'Шаг 1 из 4 — имя ученика\n\nНапишите имя или имя и фамилию одним сообщением.';
    case 'grade':
      return 'Шаг 2 из 4 — класс\n\nНапример: 9, 10 или 11.';
    case 'wishes':
      return 'Шаг 3 из 4 — цель и пожелания (необязательно)\n\nКратко опишите цель или нажмите «Пропустить».';
    case 'contact':
      return 'Шаг 4 из 4 — контакт (необязательно)\n\nТелефон или другой способ связи, либо «Пропустить».';
    default:
      return '';
  }
}

function leadFormKeyboard(step: LeadFormStep): { inline_keyboard: Array<Array<Record<string, string>>> } {
  const row: Array<Record<string, string>> = [];
  if (previousStep(step)) {
    row.push({ text: '◀️ На шаг назад', callback_data: 'cl:lead:back' });
  }
  row.push({ text: '❌ Отменить', callback_data: 'cl:lead:cancel' });
  const rows: Array<Array<Record<string, string>>> = [row];
  if (step === 'wishes') {
    rows.push([{ text: 'Пропустить', callback_data: 'cl:lead:skip:wishes' }]);
  }
  if (step === 'contact') {
    rows.push([{ text: 'Пропустить', callback_data: 'cl:lead:skip:contact' }]);
  }
  return { inline_keyboard: rows };
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

async function clearInlineKeyboard(chatId: number, messageId: number | undefined): Promise<void> {
  if (!messageId) return;
  await telegramSend('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

/** Каждый шаг — новое сообщение внизу чата. */
async function pushLeadStepMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: LeadFormPayload,
  step: LeadFormStep,
  options?: { retireMessageId?: number },
): Promise<void> {
  await clearInlineKeyboard(chatId, options?.retireMessageId ?? payload.leadFormMessageId);

  const text =
    step === 'confirm'
      ? confirmSummary(payload)
      : ['📝 Заявка на занятия', '', stepPrompt(step)].join('\n');
  const keyboard =
    step === 'confirm'
      ? {
          inline_keyboard: [
            [{ text: '✅ Отправить заявку', callback_data: 'cl:lead:submit' }],
            [{ text: '✏️ Изменить с начала', callback_data: 'cl:lead:edit' }],
            [{ text: '❌ Отменить', callback_data: 'cl:lead:cancel' }],
          ],
        }
      : leadFormKeyboard(step);

  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (!messageId) return;

  payload.leadFormMessageId = messageId;
  await persistLeadFormState(admin, telegramId, chatId, payload, step);

  const loaded = await loadClientHubPayload(admin, telegramId);
  await saveClientHub(
    admin,
    telegramId,
    { chatId, messageId: loaded?.payload.clientHubMessageId ?? 0 },
    'lead-form',
    {
      welcomeMessageId: loaded?.payload.welcomeMessageId,
      clientNavStack: loaded?.payload.clientNavStack,
      leadFormMessageId: messageId,
    },
  );
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

export async function beginClientLeadForm(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: { format: LeadFormat },
): Promise<void> {
  const payload: LeadFormPayload = { leadFormat: options.format };
  await pushLeadStepMessage(admin, telegramId, chatId, payload, 'name');
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
    await clearInlineKeyboard(chatId, messageId);
    await resetClientDialogToHub(admin, telegramId);
    await sendHubMessage(chatId, 'Заявка отменена. Выберите раздел в меню ниже.', {
      inline_keyboard: [[clientBackButton()]],
    });
    return true;
  }

  if (data.startsWith('cl:lead:fmt:')) {
    const format = data.slice('cl:lead:fmt:'.length) as LeadFormat;
    if (format !== 'individual' && format !== 'group') return true;

    const payload: LeadFormPayload = { leadFormat: format };
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'name', { retireMessageId: messageId });
    return true;
  }

  if (data === 'cl:lead:back') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = state.payload as LeadFormPayload;
    const step = payload.leadStep ?? 'name';
    const prev = previousStep(step === 'confirm' ? 'contact' : step);
    const target = prev ?? 'name';
    await pushLeadStepMessage(admin, telegramId, chatId, payload, target, { retireMessageId: messageId });
    return true;
  }

  if (data === 'cl:lead:skip:wishes') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = { ...(state.payload as LeadFormPayload), leadWishes: '' };
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'contact', { retireMessageId: messageId });
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
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'confirm', { retireMessageId: messageId });
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
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'name', { retireMessageId: messageId });
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
      await sendAdminMessage(chatId, 'Заявка неполная. Начните заново из раздела «Занятия с преподавателем».');
      await resetClientDialogToHub(admin, telegramId);
      return true;
    }

    if (await findRecentDuplicateLead(admin, telegramId, payload.leadFormat)) {
      await clearInlineKeyboard(chatId, messageId);
      await resetClientDialogToHub(admin, telegramId);
      await sendHubMessage(
        chatId,
        '⏳ Похожая заявка уже отправлена недавно.\n\nАдминистратор свяжется с вами.',
        { inline_keyboard: [[clientBackButton()]] },
      );
      return true;
    }

    const contactRaw = payload.leadContact?.trim();
    const contact =
      contactRaw && contactRaw.length > 0 ? contactRaw : `Telegram (ID ${telegramId})`;

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
        const fallback = await admin
          .from('leads')
          .insert(insertRow)
          .select(
            'id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status',
          )
          .single();
        if (fallback.error) throw fallback.error;
        await notifyAdminsOfNewLead(admin, fallback.data as LeadRow);
      } else throw error;
    } else if (inserted) {
      await notifyAdminsOfNewLead(admin, inserted as LeadRow);
    }

    await clearInlineKeyboard(chatId, messageId);
    await resetClientDialogToHub(admin, telegramId);

    await sendHubMessage(
      chatId,
      '✅ Заявка отправлена.\n\n' +
        'Администратор свяжется с вами для уточнения деталей, расписания и оплаты.',
      { inline_keyboard: [[clientBackButton()]] },
    );
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
  if (!trimmed) return true;

  const retireId = payload.leadFormMessageId;

  if (step === 'name') {
    if (trimmed.length < 3) {
      await sendHubMessage(
        chatId,
        '⚠️ Имя слишком короткое — напишите полное имя (от 3 символов).',
        leadFormKeyboard('name'),
      );
      return true;
    }
    payload.leadStudentName = trimmed;
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'grade', { retireMessageId: retireId });
    return true;
  }

  if (step === 'grade') {
    if (trimmed.length < 1) {
      await sendHubMessage(chatId, 'Укажите класс (например: 10).', leadFormKeyboard('grade'));
      return true;
    }
    payload.leadGrade = trimmed;
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'wishes', { retireMessageId: retireId });
    return true;
  }

  if (step === 'wishes') {
    payload.leadWishes = trimmed;
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'contact', { retireMessageId: retireId });
    return true;
  }

  if (step === 'contact') {
    const phone = normalizePhone(trimmed);
    payload.leadContact = phone ?? trimmed;
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'confirm', { retireMessageId: retireId });
    return true;
  }

  return false;
}
