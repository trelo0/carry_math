import type { SupabaseClient } from '@supabase/supabase-js';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { resolveMemberChatId } from '../staff/messaging';
import { resolveTeacherTelegramId } from '@/lib/bot/teacher-mapping';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  clearState,
  editAdminMessage,
  getState,
  homeButton,
  saveState,
  sendAdminMessage,
} from './core';
import { parseScheduleDateTime } from './education-ops';
import {
  createTrialLessonForLead,
  getActiveTrialForLead,
  cancelTrialLessonForLead,
  rescheduleTrialLesson,
  syncTrialLessonConducted,
  trialPrefillFromLead,
  type LeadTrialLessonRow,
} from './lead-trial';
import {
  createTrialPaymentRequest,
  skipTrialPayment,
  notifyClientTrialPaymentRequest,
  notifyClientTrialConfirmed,
  notifyAdminsTrialPaid,
} from './lead-payments';
import { logLeadEvent } from './lead-events';
import {
  type LeadRow,
  resolveLinkedTelegramId,
  setLeadStatus,
  getLead,
  LEAD_SELECT_COLUMNS,
} from './leads';

const SUBJECTS = ['Математика', 'Физика', 'Русский язык'];

/** callback: prefix + uuid + nav (код_страница, напр. w:0). */
function parseLeadNavCallback(data: string, prefix: string): { leadId: string; nav: string; rest: string[] } | null {
  if (!data.startsWith(prefix)) return null;
  const segments = data.slice(prefix.length).split(':');
  const leadId = segments[0];
  if (!leadId) return null;
  const nav = `${segments[1] ?? 'a'}:${segments[2] ?? '0'}`;
  return { leadId, nav, rest: segments.slice(3) };
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function teacherName(admin: SupabaseClient, tgId: number | null): Promise<string> {
  if (!tgId) return '—';
  const { data } = await admin.from('bot_members').select('full_name').eq('telegram_id', tgId).maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name?.trim() || `ID ${tgId}`;
}

export function isLeadTrialAction(data: string): boolean {
  return data.startsWith('al:tr:');
}

async function renderTrialConfirm(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  nav: string,
  draft: {
    subject: string;
    teacherTelegramId: number;
    teacherName: string;
    startsAt: string;
  },
): Promise<void> {
  const text = [
    '📅 Оформление пробного',
    '',
    'Я нашёл договорённости:',
    '',
    `👤 ${lead.name}`,
    `📚 ${draft.subject}`,
    `👨‍🏫 ${draft.teacherName}`,
    `📅 ${formatWhen(draft.startsAt)}`,
    '',
    'Всё верно?',
  ].join('\n');
  await editAdminMessage(message, text, {
    inline_keyboard: [
      [
        {
          text: '✅ Да, оформить',
          callback_data: `al:tr:go:${lead.id}:${nav}`,
        },
      ],
      [{ text: '✏️ Изменить', callback_data: `al:tr:ed:${lead.id}:${nav}` }],
      [{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }],
      [homeButton()],
    ],
  });
}

async function startTrialWizard(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  nav: string,
  actorTelegramId: number,
): Promise<void> {
  const linked = await resolveLinkedTelegramId(admin, lead);
  if (!linked) {
    await editAdminMessage(message, 'Нужен Telegram клиента (заявка из бота или привязанный телефон).', {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]],
    });
    return;
  }

  const prefill = trialPrefillFromLead(lead);
  const pricing = await getCabinetPricing();
  let teacherTelegramId: number | null = null;
  let teacherId: string | null = null;
  let teacherLabel = prefill.teacherName;

  if (prefill.teacherName) {
    const match = pricing.teachers.find((t) => t.name.includes(prefill.teacherName!) || prefill.teacherName!.includes(t.name));
    if (match?.telegramId) {
      teacherTelegramId = match.telegramId;
      teacherId = match.teacherId;
      teacherLabel = match.name;
    }
  }
  if (!teacherTelegramId && pricing.teachers.length === 1) {
    teacherTelegramId = pricing.teachers[0]!.telegramId;
    teacherId = pricing.teachers[0]!.teacherId;
    teacherLabel = pricing.teachers[0]!.name;
  }

  const existing = await getActiveTrialForLead(admin, lead.id);
  if (existing && existing.status === 'scheduled') {
    await renderTrialCreated(admin, message, lead, nav, existing, actorTelegramId);
    return;
  }

  if (!prefill.subject || prefill.subject === '—') {
    await renderSubjectPicker(message, lead.id, nav);
    return;
  }

  if (!teacherTelegramId) {
    await renderTeacherPicker(admin, message, lead.id, nav, prefill.subject);
    return;
  }

  await saveState(admin, actorTelegramId, message, 'admin:lead:trial:datetime', {
    leadTrialLeadId: lead.id,
    leadTrialNav: nav,
    leadTrialSubject: prefill.subject,
    leadTrialTeacherTgId: teacherTelegramId,
    leadTrialTeacherId: teacherId ?? undefined,
    leadTrialTeacherName: teacherLabel ?? undefined,
  });
  await editAdminMessage(
    message,
    `📅 Пробное · ${lead.name}\n\n🕐 Укажите дату и время (МСК):\nдд.мм.гггг чч:мм`,
    {
      inline_keyboard: [
        [{ text: '◀️ Назад', callback_data: `al:tr:${lead.id}:${nav}` }],
        [homeButton()],
      ],
    },
  );
}

async function renderSubjectPicker(message: AdminMessage, leadId: string, nav: string): Promise<void> {
  const keyboard: InlineButton[][] = SUBJECTS.map((s) => [
    { text: s, callback_data: `al:tr:sub:${leadId}:${nav}:${encodeURIComponent(s)}` },
  ]);
  keyboard.push([{ text: '◀️ Назад', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]);
  await editAdminMessage(message, '📚 Выберите предмет:', { inline_keyboard: keyboard });
}

async function renderTeacherPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  leadId: string,
  nav: string,
  subject: string,
): Promise<void> {
  const pricing = await getCabinetPricing();
  const keyboard: InlineButton[][] = [];
  for (let i = 0; i < pricing.teachers.length; i += 1) {
    const t = pricing.teachers[i]!;
    let tg = t.telegramId;
    if (!tg && t.teacherId) tg = await resolveTeacherTelegramId(admin, t.teacherId);
    if (!tg) continue;
    keyboard.push([
      {
        text: t.name,
        callback_data: `al:tr:te:${leadId}:${nav}:${i}:${encodeURIComponent(subject)}`.slice(0, 64),
      },
    ]);
  }
  if (keyboard.length === 0) {
    await editAdminMessage(message, 'Нет преподавателей с Telegram ID в настройках.', {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
    });
    return;
  }
  keyboard.push([{ text: '◀️ Назад', callback_data: `al:tr:${leadId}:${nav}` }], [homeButton()]);
  await editAdminMessage(message, '👨‍🏫 Выберите преподавателя:', { inline_keyboard: keyboard });
}

async function renderTrialCreated(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  nav: string,
  lesson: LeadTrialLessonRow,
  actorTelegramId: number,
): Promise<void> {
  await syncTrialLessonConducted(admin, lesson);
  const fresh = (await getActiveTrialForLead(admin, lead.id)) ?? lesson;
  const tName = await teacherName(admin, fresh.teacher_telegram_id);
  const price = Number(fresh.trial_price_byn ?? 15);
  const payStatus = fresh.trial_payment_status;

  const lines = [
    '📅 Пробное оформлено',
    '',
    `👤 ${lead.name}`,
    `📚 ${fresh.topic}`,
    `👨‍🏫 ${tName}`,
    `📅 ${formatWhen(fresh.starts_at)}`,
    '',
    `💰 Стоимость: ${price} BYN`,
  ];
  if (payStatus === 'paid') lines.push('', '💳 Оплачено');
  else if (payStatus === 'pending') lines.push('', '💳 Ожидает оплаты');
  else if (payStatus === 'skipped') lines.push('', '➡️ Оплата не запрашивалась');

  const keyboard: InlineButton[][] = [];
  if (fresh.status === 'scheduled') {
    if (payStatus === 'not_requested') {
      keyboard.push(
        [{ text: '💳 Запросить оплату', callback_data: `al:tr:pay:${fresh.id}:${nav}` }],
        [{ text: '➡️ Пропустить', callback_data: `al:tr:sk:${fresh.id}:${nav}` }],
      );
    }
    keyboard.push(
      [{ text: '🔄 Перенести', callback_data: `al:tr:rs:${fresh.id}:${nav}` }],
      [{ text: '❌ Отменить пробное', callback_data: `al:tr:cx:${fresh.id}:${nav}` }],
    );
  }
  if (fresh.status === 'completed') {
    keyboard.push(
      [{ text: '✅ Продолжает', callback_data: `al:tr:o:c:${fresh.id}:${nav}` }],
      [{ text: '🤔 Думает', callback_data: `al:tr:o:t:${fresh.id}:${nav}` }],
      [{ text: '❌ Не продолжает', callback_data: `al:tr:o:n:${fresh.id}:${nav}` }],
    );
  }
  keyboard.push([{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
  void actorTelegramId;
}

export async function handleLeadTrialTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  if (state.step !== 'admin:lead:trial:datetime') return false;
  const leadId = state.payload.leadTrialLeadId;
  const nav = state.payload.leadTrialNav ?? 'a:0';
  const subject = state.payload.leadTrialSubject ?? 'Математика';
  const teacherTg = state.payload.leadTrialTeacherTgId;
  const teacherName = state.payload.leadTrialTeacherName ?? 'Преподаватель';
  const rescheduleId = state.payload.leadTrialRescheduleLessonId;

  const startsAt = parseScheduleDateTime(text.trim());
  if (!startsAt) {
    await sendAdminMessage(state.chat_id, 'Не удалось разобрать дату. Пример: 08.10.2026 19:00');
    return true;
  }

  if (rescheduleId) {
    try {
      await rescheduleTrialLesson(admin, rescheduleId, startsAt, telegramId);
      await clearState(admin, telegramId);
      await sendAdminMessage(state.chat_id, `📅 Пробное перенесено\n\nНовое время:\n${formatWhen(startsAt)}`, {
        inline_keyboard: [[{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
      });
    } catch (error) {
      const msg = error instanceof ScheduleValidationError ? '⚠️ Это время уже занято.\n\nВыберите другое время.' : 'Не удалось перенести.';
      await sendAdminMessage(state.chat_id, msg);
    }
    return true;
  }

  if (!leadId || !teacherTg) {
    await clearState(admin, telegramId);
    return true;
  }

  const { data: lead } = await admin.from('leads').select(LEAD_SELECT_COLUMNS).eq('id', leadId).maybeSingle();
  if (!lead) {
    await clearState(admin, telegramId);
    return true;
  }

  await saveState(admin, telegramId, { chatId: state.chat_id, messageId: state.message_id }, 'admin:lead:trial:confirm', {
    leadTrialLeadId: leadId,
    leadTrialNav: nav,
    leadTrialSubject: subject,
    leadTrialTeacherTgId: teacherTg,
    leadTrialTeacherName: teacherName,
    leadTrialStartsAt: startsAt,
  });
  await renderTrialConfirm(
    admin,
    { chatId: state.chat_id, messageId: state.message_id },
    lead as LeadRow,
    nav,
    { subject, teacherTelegramId: teacherTg, teacherName, startsAt },
  );
  return true;
}

export async function handleLeadTrialAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
  deliver: Deliver,
): Promise<boolean> {
  if (!isLeadTrialAction(data)) return false;

  if (data.startsWith('al:tr:sub:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:sub:');
    if (!parsed) return true;
    const subject = decodeURIComponent(parsed.rest[0] ?? 'Математика');
    await renderTeacherPicker(admin, message, parsed.leadId, parsed.nav, subject);
    return true;
  }

  if (data.startsWith('al:tr:te:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:te:');
    if (!parsed) return true;
    const ti = Number(parsed.rest[0]);
    const subject = decodeURIComponent(parsed.rest[1] ?? 'Математика');
    const leadId = parsed.leadId;
    const nav = parsed.nav;
    const pricing = await getCabinetPricing();
    const teacher = pricing.teachers[ti];
    if (!teacher) return true;
    let tg = teacher.telegramId;
    if (!tg) tg = await resolveTeacherTelegramId(admin, teacher.teacherId);
    if (!tg) {
      await deliver('У преподавателя нет Telegram ID.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    await saveState(admin, actorTelegramId, message, 'admin:lead:trial:datetime', {
      leadTrialLeadId: leadId,
      leadTrialNav: nav,
      leadTrialSubject: subject,
      leadTrialTeacherTgId: tg,
      leadTrialTeacherId: teacher.teacherId,
      leadTrialTeacherName: teacher.name,
    });
    await editAdminMessage(message, `🕐 Дата и время пробного (МСК):\nдд.мм.гггг чч:мм`, {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: `al:tr:${leadId}:${nav}` }], [homeButton()]],
    });
    return true;
  }

  if (data.startsWith('al:tr:view:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:view:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const { data: lessonRow } = await admin
      .from('scheduled_lessons')
      .select('id, lead_id, telegram_id, teacher_telegram_id, starts_at, topic, trial_price_byn, trial_payment_status, status, duration_minutes')
      .eq('id', lessonId)
      .maybeSingle();
    const lead = lessonRow?.lead_id ? await getLead(admin, lessonRow.lead_id as string, LEAD_SELECT_COLUMNS) : null;
    if (lead && lessonRow) {
      await renderTrialCreated(admin, message, lead, parsed.nav, lessonRow as LeadTrialLessonRow, actorTelegramId);
    }
    return true;
  }

  if (data.startsWith('al:tr:go:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:go:');
    if (!parsed) return true;
    const leadId = parsed.leadId;
    const nav = parsed.nav;
    const st = await getState(admin, actorTelegramId);
    const teacherTg = st?.payload.leadTrialTeacherTgId;
    const startsAt = st?.payload.leadTrialStartsAt;
    if (!teacherTg || !startsAt) {
      await deliver('Черновик пробного не найден. Начните оформление заново.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
    if (!lead) {
      await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const clientTg = await resolveLinkedTelegramId(admin, lead);
    if (!clientTg) {
      await deliver('Нет Telegram клиента.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const pricing = await getCabinetPricing();
    const teacher = pricing.teachers.find((t) => t.telegramId === teacherTg);
    try {
      const { lessonId } = await createTrialLessonForLead(admin, {
        lead,
        clientTelegramId: clientTg,
        teacherTelegramId: teacherTg,
        teacherId: teacher?.teacherId ?? null,
        startsAt,
        topic: lead.service?.trim() || trialPrefillFromLead(lead).subject,
        actorTelegramId,
      });
      await setLeadStatus(admin, lead.id, 'in_progress', actorTelegramId);
      await clearState(admin, actorTelegramId);
      const lesson = await getActiveTrialForLead(admin, lead.id);
      if (lesson) await renderTrialCreated(admin, message, lead, nav, lesson, actorTelegramId);
      else await deliver(`✅ Пробное #${lessonId} создано.`, { inline_keyboard: [[homeButton()]] });
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        const { recordScheduleConflictProblem } = await import('./problems-hooks');
        await recordScheduleConflictProblem(admin, {
          message: error.message,
          teacherTelegramId: teacherTg,
          lessonKind: 'trial',
          dedupeKey: `trial-slot:${leadId}:${startsAt}`,
        });
      }
      const msg =
        error instanceof ScheduleValidationError
          ? '⚠️ Это время уже занято.\n\nВыберите другое время.'
          : '❌ Не удалось оформить пробное.';
      await editAdminMessage(message, msg, {
        inline_keyboard: [[{ text: '🕐 Выбрать время', callback_data: `al:tr:${leadId}:${nav}` }], [homeButton()]],
      });
    }
    return true;
  }

  if (data.startsWith('al:tr:ed:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:ed:');
    if (!parsed) return true;
    const lead = await getLead(admin, parsed.leadId, LEAD_SELECT_COLUMNS);
    if (lead) await startTrialWizard(admin, message, lead, parsed.nav, actorTelegramId);
    return true;
  }

  if (data.startsWith('al:tr:pay:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:pay:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const nav = parsed.nav;
    const { data: lessonRow } = await admin
      .from('scheduled_lessons')
      .select('id, lead_id, telegram_id, teacher_telegram_id, starts_at, topic, trial_price_byn, trial_payment_status, status, duration_minutes')
      .eq('id', lessonId)
      .maybeSingle();
    if (!lessonRow?.lead_id) return true;
    const lead = await getLead(admin, lessonRow.lead_id as string, LEAD_SELECT_COLUMNS);
    if (!lead) return true;
    const payment = await createTrialPaymentRequest(admin, {
      leadId: lead.id,
      lesson: lessonRow as LeadTrialLessonRow,
      actorTelegramId,
    });
    await setLeadStatus(admin, lead.id, 'in_progress', actorTelegramId);
    const chatId = await resolveMemberChatId(admin, lessonRow.telegram_id as number);
    const tName = await teacherName(admin, lessonRow.teacher_telegram_id as number);
    if (chatId) {
      await notifyClientTrialPaymentRequest(chatId, {
        subject: lessonRow.topic as string,
        teacherName: tName,
        startsAtLabel: formatWhen(lessonRow.starts_at as string),
        amountByn: payment.amountByn,
        payUrl: payment.payUrl,
      });
    }
    await renderTrialCreated(admin, message, lead, nav!, lessonRow as LeadTrialLessonRow, actorTelegramId);
    return true;
  }

  if (data.startsWith('al:tr:sk:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:sk:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const nav = parsed.nav;
    const { data: lessonRow } = await admin.from('scheduled_lessons').select('lead_id').eq('id', lessonId).maybeSingle();
    const leadId = lessonRow?.lead_id as string | undefined;
    if (leadId) await skipTrialPayment(admin, leadId, lessonId, actorTelegramId);
    const lead = leadId ? await getLead(admin, leadId, LEAD_SELECT_COLUMNS) : null;
    if (lead) {
      const lesson = await getActiveTrialForLead(admin, lead.id);
      if (lesson) await renderTrialCreated(admin, message, lead, nav!, lesson, actorTelegramId);
    }
    return true;
  }

  if (data.startsWith('al:tr:rs:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:rs:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const nav = parsed.nav;
    const { data: lessonRow } = await admin.from('scheduled_lessons').select('lead_id').eq('id', lessonId).maybeSingle();
    await saveState(admin, actorTelegramId, message, 'admin:lead:trial:datetime', {
      leadTrialLeadId: lessonRow?.lead_id as string,
      leadTrialNav: nav,
      leadTrialRescheduleLessonId: lessonId,
    });
    await editAdminMessage(message, '🕐 Новое время пробного (МСК):\nдд.мм.гггг чч:мм', {
      inline_keyboard: [[{ text: '◀️ Отмена', callback_data: `al:l:${lessonRow?.lead_id}:${nav}` }], [homeButton()]],
    });
    return true;
  }

  if (data.startsWith('al:tr:cx:') && !data.startsWith('al:tr:cxok:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:cx:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const nav = parsed.nav;
    await editAdminMessage(message, '⚠️ Отменить пробное занятие?', {
      inline_keyboard: [
        [{ text: '❌ Да, отменить', callback_data: `al:tr:cxok:${lessonId}:${nav}` }],
        [{ text: '↩️ Назад', callback_data: `al:tr:view:${lessonId}:${nav}` }],
      ],
    });
    return true;
  }

  if (data.startsWith('al:tr:cxok:')) {
    const parsed = parseLeadNavCallback(data, 'al:tr:cxok:');
    if (!parsed) return true;
    const lessonId = Number(parsed.rest[0]);
    const nav = parsed.nav;
    const { data: lessonRow } = await admin.from('scheduled_lessons').select('lead_id').eq('id', lessonId).maybeSingle();
    await cancelTrialLessonForLead(admin, lessonId, actorTelegramId);
    const leadId = lessonRow?.lead_id as string | undefined;
    if (leadId) await setLeadStatus(admin, leadId, 'in_progress', actorTelegramId);
    const lead = leadId ? await getLead(admin, leadId, LEAD_SELECT_COLUMNS) : null;
    if (lead) await editAdminMessage(message, 'Пробное отменено.', {
      inline_keyboard: [[{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]],
    });
    return true;
  }

  if (data.startsWith('al:tr:o:')) {
    const parts = data.split(':');
    const outcome = parts[3];
    const lessonId = Number(parts[4]);
    const nav = `${parts[5] ?? 'a'}:${parts[6] ?? '0'}`;
    const { data: lessonRow } = await admin.from('scheduled_lessons').select('lead_id').eq('id', lessonId).maybeSingle();
    const leadId = lessonRow?.lead_id as string | undefined;
    if (!leadId) return true;
    if (outcome === 'c') {
      await setLeadStatus(admin, leadId, 'in_progress', actorTelegramId);
      await logLeadEvent(admin, { leadId, eventType: 'outcome_continues', actorTelegramId });
      const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
      if (lead) {
        const { startLeadEnrollment } = await import('./lead-enrollment-flow');
        await startLeadEnrollment(admin, message, lead, nav);
      }
    } else if (outcome === 't') {
      await setLeadStatus(admin, leadId, 'in_progress', actorTelegramId);
      await logLeadEvent(admin, { leadId, eventType: 'outcome_thinking', actorTelegramId });
      const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
      if (lead) {
        const { renderThinkingReminderPicker } = await import('./lead-followups');
        await renderThinkingReminderPicker(admin, message, leadId, nav, lead.name);
      }
    } else {
      await setLeadStatus(admin, leadId, 'cancelled', actorTelegramId);
      await logLeadEvent(admin, { leadId, eventType: 'outcome_declined', actorTelegramId });
      await logLeadEvent(admin, { leadId, eventType: 'lead_closed', actorTelegramId, detail: { reason: 'declined' } });
      await deliver('🟢 Заявка закрыта.\n\nПричина: клиент не продолжает обучение.', {
        inline_keyboard: [[{ text: '⬅️ Обзор', callback_data: 'al:menu' }], [homeButton()]],
      });
    }
    return true;
  }

  const rest = data.slice('al:tr:'.length);
  if (
    rest.startsWith('go:') ||
    rest.startsWith('sub:') ||
    rest.startsWith('te:') ||
    rest.startsWith('ed:') ||
    rest.startsWith('pay:') ||
    rest.startsWith('sk:') ||
    rest.startsWith('rs:') ||
    rest.startsWith('cx') ||
    rest.startsWith('o:') ||
    rest.startsWith('view:')
  ) {
    return true;
  }
  const colon = rest.indexOf(':');
  const leadId = colon >= 0 ? rest.slice(0, colon) : rest;
  const nav = colon >= 0 ? rest.slice(colon + 1) : 'a:0';
  const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
  if (!lead) {
    await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
    return true;
  }
  await startTrialWizard(admin, message, lead, nav, actorTelegramId);
  return true;
}
