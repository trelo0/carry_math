import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { resolvePurchaseOffer } from '@/lib/bot/purchase-fulfillment';
import { createPurchaseRequest } from '@/lib/bot/purchase-requests';
import { buildPayStartPayload } from '@/lib/bot/studentPurchaseFlow';
import { getActiveCourses, enrollStudent } from '@/lib/bot/education/courses';
import { resolveMemberChatId } from '../staff/messaging';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { logLeadEvent } from './lead-events';
import { getLead, LEAD_SELECT_COLUMNS, resolveLinkedTelegramId, setLeadStatus, type LeadRow } from './leads';

function parseEnNav(data: string, prefix: string): { leadId: string; nav: string; rest: string[] } | null {
  if (!data.startsWith(prefix)) return null;
  const parts = data.slice(prefix.length).split(':');
  const leadId = parts[0];
  if (!leadId) return null;
  const nav = `${parts[1] ?? 'a'}:${parts[2] ?? '0'}`;
  return { leadId, nav, rest: parts.slice(3) };
}

export function isLeadEnrollmentAction(data: string): boolean {
  return data.startsWith('al:en:');
}

export async function startLeadEnrollment(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  nav: string,
): Promise<void> {
  const tg = await resolveLinkedTelegramId(admin, lead);
  const lines = [
    '✅ Оформление ученика',
    '',
    `Заявка: ${lead.name}`,
    tg ? `Telegram ID: ${tg}` : '⚠️ Telegram клиента не найден — часть шагов недоступна.',
    '',
    'Выберите следующий шаг. История останется привязана к заявке.',
  ];
  const keyboard: InlineButton[][] = [
    [{ text: '🎓 Курс District', callback_data: `al:en:c:${lead.id}:${nav}` }],
    [{ text: '👤 Индивидуальные', callback_data: `al:en:i:${lead.id}:${nav}` }],
    [{ text: '👥 Групповые', callback_data: `al:en:g:${lead.id}:${nav}` }],
  ];
  if (tg) {
    keyboard.push([{ text: '📅 Расписание ученика', callback_data: `al:en:ls:${lead.id}:${nav}` }]);
    keyboard.push([{ text: '👤 Карточка человека', callback_data: `admin:user:${tg}::` }]);
  }
  keyboard.push(
    [{ text: '✅ Оформление завершено', callback_data: `al:en:done:${lead.id}:${nav}` }],
    [{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }],
    [homeButton()],
  );
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function handleLeadEnrollmentAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
  deliver: Deliver,
): Promise<boolean> {
  if (!isLeadEnrollmentAction(data)) return false;

  if (data.startsWith('al:en:done:')) {
    const parsed = parseEnNav(data, 'al:en:done:');
    if (!parsed) return true;
    await setLeadStatus(admin, parsed.leadId, 'completed', actorTelegramId);
    await logLeadEvent(admin, {
      leadId: parsed.leadId,
      eventType: 'enrollment_completed',
      actorTelegramId,
    });
    await deliver('🟢 Оформление завершено. Заявка закрыта как успешная.', {
      inline_keyboard: [[{ text: '⬅️ Заявки', callback_data: 'al:menu' }], [homeButton()]],
    });
    return true;
  }

  if (data.startsWith('al:en:ls:')) {
    const parsed = parseEnNav(data, 'al:en:ls:');
    if (!parsed) return true;
    const lead = await getLead(admin, parsed.leadId, LEAD_SELECT_COLUMNS);
    const tg = lead ? await resolveLinkedTelegramId(admin, lead) : null;
    if (!tg) {
      await deliver('Нет Telegram ученика.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    await deliver('📅 Расписание — выберите ученика в разделе «Обучение → Расписание» или кнопку ниже.', {
      inline_keyboard: [
        [{ text: '👤 Ученик в расписании', callback_data: `ae:ls:stu:${tg}:0` }],
        [{ text: '◀️ Назад', callback_data: `al:en:hub:${parsed.leadId}:${parsed.nav}` }],
        [homeButton()],
      ],
    });
    return true;
  }

  if (data.startsWith('al:en:hub:')) {
    const parsed = parseEnNav(data, 'al:en:hub:');
    if (!parsed) return true;
    const lead = await getLead(admin, parsed.leadId, LEAD_SELECT_COLUMNS);
    if (lead) await startLeadEnrollment(admin, message, lead, parsed.nav);
    return true;
  }

  if (data.startsWith('al:en:c:pick:')) {
    const parsed = parseEnNav(data, 'al:en:c:pick:');
    if (!parsed) return true;
    const courseId = Number(parsed.rest[0]);
    const lead = await getLead(admin, parsed.leadId, LEAD_SELECT_COLUMNS);
    if (!lead) return true;
    const tg = await resolveLinkedTelegramId(admin, lead);
    if (!tg) {
      await deliver('Нужен Telegram клиента для зачисления.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    await enrollStudent(admin, tg, courseId);
    await admin.from('bot_members').update({ role: 'student', updated_at: new Date().toISOString() }).eq('telegram_id', tg);
    await logLeadEvent(admin, {
      leadId: parsed.leadId,
      eventType: 'enrollment_course',
      actorTelegramId,
      detail: { course_id: courseId, telegram_id: tg },
    });
    const chatId = await resolveMemberChatId(admin, tg);
    if (chatId) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: '🎓 Вас зачислили на курс District.\n\nОткройте личный кабинет — там доступ к программе.',
      });
    }
    await startLeadEnrollment(admin, message, lead, parsed.nav);
    return true;
  }

  if (data.startsWith('al:en:c:') && !data.startsWith('al:en:c:pick:')) {
    const parsed = parseEnNav(data, 'al:en:c:');
    if (!parsed) return true;
    const courses = await getActiveCourses(admin);
    if (courses.length === 0) {
      await deliver('Нет активных курсов в базе.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const keyboard: InlineButton[][] = courses.map((c) => [
      {
        text: shorten(c.title, 36),
        callback_data: `al:en:c:pick:${parsed.leadId}:${parsed.nav}:${c.id}`,
      },
    ]);
    keyboard.push([{ text: '◀️ Назад', callback_data: `al:en:hub:${parsed.leadId}:${parsed.nav}` }], [homeButton()]);
    await editAdminMessage(message, '🎓 Выберите курс:', { inline_keyboard: keyboard });
    return true;
  }

  const productMatch = data.match(/^al:en:([ig]):req:(.+)$/);
  if (productMatch) {
    const product = productMatch[1] === 'i' ? 'individual' : 'group';
    const tail = productMatch[2]!.split(':');
    const leadId = tail[0]!;
    const nav = `${tail[1] ?? 'a'}:${tail[2] ?? '0'}`;
    const pkgIndex = Number(tail[3]);
    const teacherIndex = Number(tail[4]);
    const lead = await getLead(admin, leadId, LEAD_SELECT_COLUMNS);
    if (!lead) return true;
    const tg = await resolveLinkedTelegramId(admin, lead);
    if (!tg) {
      await deliver('Нужен Telegram клиента.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const pricing = await getCabinetPricing();
    const teacher = pricing.teachers[teacherIndex] ?? pricing.teachers[0];
    const offer = await resolvePurchaseOffer(pricing, {
      product,
      packageIndex: pkgIndex,
      teacherId: teacher?.teacherId,
    });
    const request = await createPurchaseRequest(admin, {
      telegramId: tg,
      product,
      packageIndex: pkgIndex,
      teacherId: teacher?.teacherId ?? null,
      title: offer.title,
      amountByn: offer.amountByn,
    });
    await logLeadEvent(admin, {
      leadId,
      eventType: 'enrollment_purchase_request',
      actorTelegramId,
      detail: { request_id: request.id, product },
    });
    const chatId = await resolveMemberChatId(admin, tg);
    const payPayload = buildPayStartPayload(product, pkgIndex, teacherIndex);
    const botUser = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    const payLink = botUser ? `https://t.me/${botUser}?start=${payPayload}` : payPayload;
    if (chatId) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: `💳 ${offer.title}\nСумма: ${offer.amountByn} BYN\n\nДля оплаты перейдите в бот:\n${payLink}`,
      });
    }
    await deliver(`✅ Заявка на оплату создана (#${request.id.slice(0, 8)}).\nКлиенту отправлена ссылка на оплату.`, {
      inline_keyboard: [
        [{ text: '💳 Оплаты админ', callback_data: 'ap:menu' }],
        [{ text: '◀️ Оформление', callback_data: `al:en:hub:${leadId}:${nav}` }],
        [homeButton()],
      ],
    });
    return true;
  }

  if (data.startsWith('al:en:i:') || data.startsWith('al:en:g:')) {
    const product = data.startsWith('al:en:i:') ? 'individual' : 'group';
    const prefix = product === 'individual' ? 'al:en:i:' : 'al:en:g:';
    const parsed = parseEnNav(data, prefix);
    if (!parsed) return true;
    const pricing = await getCabinetPricing();
    const pack = pricing[product];
    const keyboard: InlineButton[][] = pack.options.map((opt, index) => [
      {
        text: opt.name,
        callback_data: `al:en:${product === 'individual' ? 'i' : 'g'}:req:${parsed.leadId}:${parsed.nav}:${index}:0`,
      },
    ]);
    keyboard.push([{ text: '◀️ Назад', callback_data: `al:en:hub:${parsed.leadId}:${parsed.nav}` }], [homeButton()]);
    await editAdminMessage(message, `📦 Выберите пакет (${product === 'individual' ? 'индивид.' : 'группа'}):`, {
      inline_keyboard: keyboard,
    });
    return true;
  }

  return false;
}
