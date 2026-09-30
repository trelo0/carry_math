import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { fulfillPurchase } from './purchase-fulfillment';
import {
  getPurchaseRequest,
  markPurchaseRequestResolved,
  type PurchaseRequestRow,
} from './purchase-requests';
import { refreshClientMenu } from './client-flow';
import { getMember, type BotRole } from './roles';

export function purchaseRequestExternalId(requestId: string): string {
  return `purchase_request:${requestId}`;
}

function formatRequestRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

async function notifyStudentPurchaseConfirmed(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
  lessons: number,
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', request.telegram_id)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const cabinetPath =
    request.product === 'course' ? '/cabinet?section=course' : '/cabinet?section=payments';
  const cabinetUrl = await createCabinetLoginUrl(admin, request.telegram_id, cabinetPath);

  const lines = ['✅ Оплата подтверждена', '', `Покупка:`, request.title, ''];

  if (request.product === 'course') {
    lines.push('Курс доступен в личном кабинете.');
  } else {
    lines.push(`Вам начислено:`, `${lessons} ${lessons === 1 ? 'занятие' : lessons < 5 ? 'занятия' : 'занятий'}`, '', 'Теперь вы можете записаться на занятие.');
  }

  lines.push('', cabinetUrl);

  await telegramSend('sendMessage', { chat_id: chatId, text: lines.join('\n') });
}

async function notifyStudentPurchaseRejected(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', request.telegram_id)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text:
      `❌ Заявка отклонена\n\n` +
      `${request.title}\n\n` +
      `Если это ошибка — напишите администратору или оформите заявку заново в боте.`,
  });
}

export type ConfirmPurchaseResult = {
  alreadyProcessed: boolean;
  alreadyFulfilled: boolean;
  note: string;
  verificationLines: string[];
  request: PurchaseRequestRow;
};

/** Подтверждение оплаты: verify (manual admin) → fulfill. Идемпотентно. */
export async function confirmPurchaseRequest(
  admin: SupabaseClient,
  requestId: string,
  adminTelegramId?: number,
): Promise<ConfirmPurchaseResult> {
  const request = await getPurchaseRequest(admin, requestId);
  if (!request) {
    throw new Error('Заявка не найдена');
  }

  if (request.status === 'approved') {
    return {
      alreadyProcessed: true,
      alreadyFulfilled: true,
      note: 'Заявка уже подтверждена.',
      verificationLines: [],
      request,
    };
  }

  if (request.status !== 'pending') {
    return {
      alreadyProcessed: true,
      alreadyFulfilled: false,
      note: 'Заявка уже обработана.',
      verificationLines: [],
      request,
    };
  }

  const result = await fulfillPurchase(admin, request.telegram_id, {
    product: request.product,
    packageIndex: request.package_index,
    teacherId: request.teacher_id ?? undefined,
    externalId: purchaseRequestExternalId(request.id),
  });

  const marked = await markPurchaseRequestResolved(admin, request.id, 'approved', adminTelegramId);
  const updated = (await getPurchaseRequest(admin, requestId)) ?? request;

  if (!marked && updated.status !== 'approved') {
    throw new Error('Не удалось обновить статус заявки после выдачи доступа. Повторите подтверждение.');
  }

  if (!result.alreadyFulfilled) {
    await notifyStudentPurchaseConfirmed(admin, updated, result.offer.lessons);
    const member = await getMember(admin, updated.telegram_id);
    const { data: chatRow } = await admin
      .from('bot_members')
      .select('chat_id')
      .eq('telegram_id', updated.telegram_id)
      .maybeSingle();
    const chatId = chatRow?.chat_id as number | undefined;
    if (chatId) {
      await refreshClientMenu(admin, updated.telegram_id, chatId, member?.role as BotRole | undefined);
    }
  }

  const note = result.alreadyFulfilled
    ? 'Заявка уже была выполнена ранее (idempotency).'
    : '✅ Доступ выдан, ученик уведомлён.';

  return {
    alreadyProcessed: false,
    alreadyFulfilled: result.alreadyFulfilled,
    note,
    verificationLines: result.verificationLines,
    request: updated,
  };
}

export async function rejectPurchaseRequest(
  admin: SupabaseClient,
  requestId: string,
  adminTelegramId?: number,
): Promise<{ note: string; request: PurchaseRequestRow }> {
  const request = await getPurchaseRequest(admin, requestId);
  if (!request) {
    throw new Error('Заявка не найдена');
  }

  if (request.status !== 'pending') {
    return { note: 'Заявка уже обработана.', request };
  }

  const marked = await markPurchaseRequestResolved(admin, request.id, 'rejected', adminTelegramId);
  const updated = (await getPurchaseRequest(admin, requestId)) ?? request;

  if (marked) {
    await notifyStudentPurchaseRejected(admin, updated);
    return { note: '❌ Заявка отклонена, ученик уведомлён.', request: updated };
  }

  return { note: 'Заявка уже обработана.', request: updated };
}

export function formatAdminPurchaseRequestNotification(
  request: PurchaseRequestRow,
  userLabel: string,
): string {
  return [
    '💳 НОВАЯ ЗАЯВКА НА ОПЛАТУ',
    '',
    'Ученик:',
    userLabel,
    '',
    'Товар:',
    request.title,
    '',
    'Сумма:',
    `${Number(request.amount_byn)} BYN`,
    '',
    'Заявка:',
    `#${formatRequestRef(request.id)}`,
    '',
    'Статус:',
    'Ожидает оплаты',
  ].join('\n');
}

export function adminPurchaseRequestKeyboard(requestId: string): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить оплату', callback_data: `ap:ok:${requestId}:p:0` },
        { text: '❌ Отклонить', callback_data: `ap:x:${requestId}:p:0` },
      ],
      [{ text: '💳 Открыть заявку', callback_data: `ap:l:${requestId}:p:0` }],
    ],
  };
}
