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
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { BOT_COPY_KEYS, getBotCopy } from '@/lib/bot/bot-copy';
import { isClientReplyLabel } from '@/lib/bot/client-menu';

export const CLIENT_LEAD_FORM_STEP = 'client:lead-form' as const;

export type LeadFormat = 'individual' | 'group';

type LeadFormStep = 'name' | 'grade' | 'preferredTeacher' | 'wishes' | 'contact' | 'confirm';

export type LeadIntent = 'trial' | 'enroll';

export type LeadFormPayload = AdminPayload & {
  leadFormat?: LeadFormat;
  leadIntent?: LeadIntent;
  leadTeacherLocked?: boolean;
  leadStudentName?: string;
  leadGrade?: string;
  leadPreferredTeacher?: string;
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

function formatLabel(format: LeadFormat): string {
  return FORMAT_LABEL[format];
}

function intentLabel(intent: LeadIntent | undefined): string {
  return intent === 'trial' ? 'Пробное занятие' : 'Запись на занятия';
}

function serviceLabel(payload: LeadFormPayload): string {
  const format = payload.leadFormat ? formatLabel(payload.leadFormat) : 'Занятия';
  if (payload.leadIntent === 'trial') return `${format} · Пробное`;
  if (payload.leadIntent === 'enroll') return `${format} · Запись`;
  return format;
}

function leadSteps(payload: Pick<LeadFormPayload, 'leadFormat' | 'leadTeacherLocked'>): LeadFormStep[] {
  if (payload.leadFormat === 'individual' && !payload.leadTeacherLocked) {
    return ['name', 'grade', 'preferredTeacher', 'wishes', 'contact', 'confirm'];
  }
  return ['name', 'grade', 'wishes', 'contact', 'confirm'];
}

function previousStep(payload: LeadFormPayload, step: LeadFormStep): LeadFormStep | null {
  const order = leadSteps(payload);
  const i = order.indexOf(step);
  if (i <= 0) return null;
  return order[i - 1] ?? null;
}

function stepIndexLabel(payload: LeadFormPayload, step: LeadFormStep): string {
  if (step === 'confirm') return '';
  const order = leadSteps(payload).filter((s) => s !== 'confirm') as Exclude<
    LeadFormStep,
    'confirm'
  >[];
  const i = order.indexOf(step as Exclude<LeadFormStep, 'confirm'>);
  if (i < 0) return '';
  return `Шаг ${i + 1} из ${order.length} — `;
}

async function stepPrompt(payload: LeadFormPayload, step: LeadFormStep): Promise<string> {
  const prefix = stepIndexLabel(payload, step);
  switch (step) {
    case 'name':
      return prefix + (await getBotCopy(BOT_COPY_KEYS.guestLeadStepName));
    case 'grade':
      return prefix + (await getBotCopy(BOT_COPY_KEYS.guestLeadStepGrade));
    case 'preferredTeacher':
      return prefix + (await getBotCopy(BOT_COPY_KEYS.guestLeadStepPreferredTeacher));
    case 'wishes':
      return prefix + (await getBotCopy(BOT_COPY_KEYS.guestLeadStepWishes));
    case 'contact':
      return prefix + (await getBotCopy(BOT_COPY_KEYS.guestLeadStepContact));
    default:
      return '';
  }
}

async function leadFormKeyboard(
  payload: LeadFormPayload,
  step: LeadFormStep,
): Promise<{ inline_keyboard: Array<Array<Record<string, string>>> }> {
  const row: Array<Record<string, string>> = [];
  if (previousStep(payload, step)) {
    row.push({ text: '◀️ На шаг назад', callback_data: 'cl:lead:back' });
  }
  row.push({ text: '❌ Отменить', callback_data: 'cl:lead:cancel' });
  const rows: Array<Array<Record<string, string>>> = [row];
  if (step === 'preferredTeacher') {
    const pricing = await getCabinetPricing();
    for (const teacher of pricing.teachers) {
      rows.push([
        {
          text: teacher.name,
          callback_data: `cl:lead:pick:${encodeURIComponent(teacher.teacherId)}`,
        },
      ]);
    }
    rows.push([{ text: 'Не важно', callback_data: 'cl:lead:skip:teacher' }]);
  }
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
  const lines = [
    '📝 Проверьте заявку',
    '',
    `Формат: ${formatLabel(format)}`,
    `Тип: ${intentLabel(payload.leadIntent)}`,
    `Имя ученика: ${payload.leadStudentName}`,
    `Класс: ${payload.leadGrade}`,
  ];
  if (payload.leadFormat === 'individual' || payload.leadPreferredTeacher?.trim()) {
    lines.push(
      payload.leadPreferredTeacher?.trim()
        ? `Преподаватель: ${payload.leadPreferredTeacher.trim()}`
        : 'Преподаватель: не указан',
    );
  }
  lines.push(
    payload.leadWishes?.trim() ? `Пожелания: ${payload.leadWishes.trim()}` : 'Пожелания: не указаны',
    payload.leadContact?.trim()
      ? `Контакт: ${payload.leadContact.trim()}`
      : 'Контакт: не указан (связь через Telegram)',
  );
  return lines.join('\n');
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

  const header = await getBotCopy(BOT_COPY_KEYS.guestLeadHeader);
  const text =
    step === 'confirm'
      ? confirmSummary(payload)
      : [header, '', await stepPrompt(payload, step)].join('\n');
  const keyboard =
    step === 'confirm'
      ? {
          inline_keyboard: [
            [{ text: '✅ Отправить заявку', callback_data: 'cl:lead:submit' }],
            [{ text: '✏️ Изменить с начала', callback_data: 'cl:lead:edit' }],
            [{ text: '❌ Отменить', callback_data: 'cl:lead:cancel' }],
          ],
        }
      : await leadFormKeyboard(payload, step);

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
  const servicePrefix = formatLabel(format);
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .eq('source', 'telegram_bot')
    .ilike('service', `${servicePrefix}%`)
    .gte('created_at', since)
    .ilike('comment', `%${tag}%`)
    .eq('status', 'new')
    .limit(1);
  if (error && isLeadStatusColumnError(error)) {
    const fallback = await admin
      .from('leads')
      .select('id')
      .eq('source', 'telegram_bot')
      .ilike('service', `${servicePrefix}%`)
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
  options: {
    format: LeadFormat;
    intent?: LeadIntent;
    teacherId?: string;
    teacherName?: string;
    teacherLocked?: boolean;
  },
): Promise<void> {
  let teacherName = options.teacherName?.trim() || '';
  if (!teacherName && options.teacherId) {
    const pricing = await getCabinetPricing().catch(() => null);
    const matched = pricing?.teachers.find((t) => t.teacherId === options.teacherId);
    teacherName = matched?.name ?? '';
  }

  const teacherLocked = Boolean(
    options.teacherLocked ?? (options.teacherId || options.teacherName),
  );

  const payload: LeadFormPayload = {
    leadFormat: options.format,
    leadIntent: options.intent ?? 'enroll',
    leadTeacherLocked: teacherLocked && Boolean(teacherName),
    leadPreferredTeacher: teacherName || undefined,
  };

  const introBits = [
    `Формат: ${formatLabel(options.format)}`,
    `Тип: ${intentLabel(payload.leadIntent)}`,
  ];
  if (payload.leadPreferredTeacher) {
    introBits.push(`Преподаватель: ${payload.leadPreferredTeacher}`);
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: [
      'Спасибо, что заинтересовались занятиями! 🙌',
      '',
      ...introBits,
      '',
      'Осталось коротко заполнить заявку — администратор свяжется с вами.',
    ].join('\n'),
  });

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
    const prev = previousStep(payload, step === 'confirm' ? 'contact' : step);
    const target = prev ?? 'name';
    await pushLeadStepMessage(admin, telegramId, chatId, payload, target, { retireMessageId: messageId });
    return true;
  }

  if (data === 'cl:lead:skip:teacher') {
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const payload = { ...(state.payload as LeadFormPayload), leadPreferredTeacher: '' };
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'wishes', { retireMessageId: messageId });
    return true;
  }

  if (data.startsWith('cl:lead:pick:')) {
    const teacherId = decodeURIComponent(data.slice('cl:lead:pick:'.length));
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (!state || state.step !== CLIENT_LEAD_FORM_STEP) return true;
    const pricing = await getCabinetPricing();
    const teacher = pricing.teachers.find((t) => t.teacherId === teacherId);
    const payload = {
      ...(state.payload as LeadFormPayload),
      leadPreferredTeacher: teacher?.name ?? teacherId,
    };
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'wishes', { retireMessageId: messageId });
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
    const intentBlock = `Тип: ${intentLabel(payload.leadIntent)}`;
    const comment = [intentBlock, wishesBlock, TELEGRAM_ID_TAG(telegramId)]
      .filter(Boolean)
      .join('\n\n');

    const insertRow: Record<string, unknown> = {
      name: payload.leadStudentName.trim(),
      contact,
      grade: payload.leadGrade.trim(),
      comment,
      service: serviceLabel(payload),
      source: 'telegram_bot',
      inquiry_kind: 'application',
      client_telegram_id: telegramId,
    };
    if (payload.leadPreferredTeacher?.trim()) {
      insertRow.teacher = payload.leadPreferredTeacher.trim();
    }

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
      const row = inserted as LeadRow;
      try {
        const { logLeadEvent } = await import('./admin/lead-events');
        await logLeadEvent(admin, {
          leadId: row.id,
          eventType: 'lead_created',
          actorTelegramId: telegramId,
        });
      } catch {
        /* lead_events optional until migration */
      }
      await notifyAdminsOfNewLead(admin, row);
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
  if (isClientReplyLabel(text)) return false;

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
        await leadFormKeyboard(payload, 'name'),
      );
      return true;
    }
    payload.leadStudentName = trimmed;
    await pushLeadStepMessage(admin, telegramId, chatId, payload, 'grade', { retireMessageId: retireId });
    return true;
  }

  if (step === 'grade') {
    if (trimmed.length < 1) {
      await sendHubMessage(
        chatId,
        'Укажите класс (например: 10).',
        await leadFormKeyboard(payload, 'grade'),
      );
      return true;
    }
    payload.leadGrade = trimmed;
    const steps = leadSteps(payload);
    const gradeIdx = steps.indexOf('grade');
    const next = steps[gradeIdx + 1] ?? 'wishes';
    await pushLeadStepMessage(admin, telegramId, chatId, payload, next, { retireMessageId: retireId });
    return true;
  }

  if (step === 'preferredTeacher') {
    payload.leadPreferredTeacher = trimmed;
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
