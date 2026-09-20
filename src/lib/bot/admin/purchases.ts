import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { ACCESS_PRODUCT_LABELS } from '../accesses';
import { fulfillPurchase } from '../purchase-fulfillment';
import {
  countPendingPurchaseRequests,
  getPurchaseRequest,
  isPurchaseRequestTableError,
  listPendingPurchaseRequests,
  setPurchaseRequestStatus,
  type PurchaseRequestRow,
} from '../purchase-requests';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  migrationText,
} from './core';

export type PurchaseFilter = 'pending' | 'all';

const PURCHASES_PER_PAGE = 5;
const FILTER_PENDING_CODE = 'p';
const FILTER_ALL_CODE = 'a';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(amount: number): string {
  return `${amount} BYN`;
}

function requestCard(request: PurchaseRequestRow, index: number): string {
  return [
    `${index}. ${ACCESS_PRODUCT_LABELS[request.product]}`,
    `   ${request.title}`,
    `   💳 ${formatMoney(Number(request.amount_byn))} · 🕐 ${formatDateTime(request.created_at)}`,
  ].join('\n');
}

async function getMemberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  const phone = link?.phone ?? member?.phone;
  const name = member?.full_name;
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return `ID ${telegramId}`;
}

async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

export async function notifyAdminsOfNewPurchaseRequest(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
): Promise<number> {
  const userLabel = await getMemberLabel(admin, request.telegram_id);
  const lines = [
    '🔔 *Новая заявка на покупку*',
    '',
    `👤 ${userLabel}`,
    `📦 ${request.title}`,
    `💳 ${formatMoney(Number(request.amount_byn))}`,
    '',
    `🕐 ${formatDateTime(request.created_at)}`,
  ];

  const keyboard = {
    inline_keyboard: [[{ text: '💳 Открыть заявку', callback_data: `ap:l:${request.id}:p:0` }]],
  };

  const chatIds = await getAdminChatIds(admin);
  let sent = 0;
  for (const chatId of chatIds) {
    const result = await telegramSend('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    if (result.ok) sent += 1;
    else console.error('Не удалось доставить заявку на покупку администратору:', result.description);
  }
  return sent;
}

async function listRequests(admin: SupabaseClient, filter: PurchaseFilter): Promise<PurchaseRequestRow[]> {
  if (filter === 'pending') return listPendingPurchaseRequests(admin, 100);
  const { data, error } = await admin
    .from('purchase_requests')
    .select('id, created_at, resolved_at, telegram_id, product, package_index, teacher_id, title, amount_byn, status, resolved_by')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PurchaseRequestRow[];
}

async function renderPurchasesScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: PurchaseFilter,
  page: number,
): Promise<void> {
  const all = await listRequests(admin, filter);
  const pendingCount = await countPendingPurchaseRequests(admin);
  const pageCount = Math.max(1, Math.ceil(all.length / PURCHASES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * PURCHASES_PER_PAGE, (safePage + 1) * PURCHASES_PER_PAGE);

  const filterCode = filter === 'pending' ? FILTER_PENDING_CODE : FILTER_ALL_CODE;
  const keyboard: InlineButton[][] = [
    [
      {
        text: filter === 'pending' ? '● Ожидают' : '○ Ожидают',
        callback_data: `ap:f:${FILTER_PENDING_CODE}:0`,
      },
      {
        text: filter === 'all' ? '● Все' : '○ Все',
        callback_data: `ap:f:${FILTER_ALL_CODE}:0`,
      },
    ],
  ];

  for (const request of slice) {
    keyboard.push([
      {
        text: `${request.status === 'pending' ? '⏳' : request.status === 'approved' ? '✅' : '❌'} ${ACCESS_PRODUCT_LABELS[request.product]}`,
        callback_data: `ap:l:${request.id}:${filterCode}:${safePage}`,
      },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: '◀️',
        callback_data: safePage > 0 ? `ap:f:${filterCode}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: '▶️',
        callback_data: safePage < pageCount - 1 ? `ap:f:${filterCode}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([homeButton()]);

  const title = filter === 'pending' ? '⏳ Ожидают оплаты' : '📋 Все заявки';
  const text =
    all.length === 0
      ? `💳 Заявки на оплату\n\nОжидают: ${pendingCount}\n\n${title}: пока пусто.`
      : [
          '💳 Заявки на оплату',
          '',
          `Ожидают: ${pendingCount}`,
          '',
          title,
          '',
          ...(await Promise.all(
            slice.map(async (request, index) => {
              const user = await getMemberLabel(admin, request.telegram_id);
              return [
                `${safePage * PURCHASES_PER_PAGE + index + 1}. ${user}`,
                requestCard(request, safePage * PURCHASES_PER_PAGE + index + 1),
              ].join('\n');
            }),
          )),
        ].join('\n');

  await deliver(text, { inline_keyboard: keyboard });
}

export async function renderPurchasesMenu(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  await renderPurchasesScreen(admin, deliver, 'pending', 0);
}

async function renderPurchaseDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  request: PurchaseRequestRow,
  filter: PurchaseFilter,
  page: number,
  verificationLines: string[] = [],
): Promise<void> {
  const userLabel = await getMemberLabel(admin, request.telegram_id);
  const statusLabel =
    request.status === 'pending' ? '⏳ Ожидает' : request.status === 'approved' ? '✅ Одобрена' : '❌ Отклонена';

  const lines = [
    '💳 Заявка на покупку',
    '',
    `👤 ${userLabel}`,
    `📦 ${request.title}`,
    `💳 ${formatMoney(Number(request.amount_byn))}`,
    `📚 ${ACCESS_PRODUCT_LABELS[request.product]}`,
    '',
    `🕐 ${formatDateTime(request.created_at)}`,
    '',
    `Статус: ${statusLabel}`,
  ];

  if (verificationLines.length) {
    lines.push('', ...verificationLines);
  }

  const filterCode = filter === 'pending' ? FILTER_PENDING_CODE : FILTER_ALL_CODE;
  const back = { text: '◀️ К списку', callback_data: `ap:f:${filterCode}:${page}` };
  const keyboard: InlineButton[][] = [];

  if (request.status === 'pending') {
    keyboard.push(
      [{ text: '✅ Одобрить и выдать доступ', callback_data: `ap:ok:${request.id}:${filterCode}:${page}` }],
      [{ text: '❌ Отклонить', callback_data: `ap:x:${request.id}:${filterCode}:${page}` }],
    );
  }
  keyboard.push([back], [homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function approvePurchaseRequest(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
  adminTelegramId: number,
): Promise<{ note: string; verificationLines: string[] }> {
  if (request.status !== 'pending') {
    return { note: 'Заявка уже обработана.', verificationLines: [] };
  }

  const result = await fulfillPurchase(admin, request.telegram_id, {
    product: request.product,
    packageIndex: request.package_index,
    teacherId: request.teacher_id ?? undefined,
    externalId: `purchase_request:${request.id}`,
  });

  await setPurchaseRequestStatus(admin, request.id, 'approved', adminTelegramId);

  const cabinetPath =
    request.product === 'course' ? '/cabinet?section=course' : '/cabinet?section=payments';
  const cabinetUrl = await createCabinetLoginUrl(admin, request.telegram_id, cabinetPath);

  const studentLines = [
    '✅ Заявка одобрена',
    '',
    request.title,
    '',
    'Доступ открыт в личном кабинете. Обновите страницу, если не видите изменений.',
  ];
  if (request.product === 'course' && result.snapshot.lessonAccessCount > 0) {
    studentLines.push('', `Открыто уроков: ${result.snapshot.lessonAccessCount}`);
  }
  studentLines.push('', cabinetUrl);

  await telegramSend('sendMessage', {
    chat_id: request.telegram_id,
    text: studentLines.join('\n'),
  });

  const note = result.alreadyFulfilled
    ? 'Заявка уже была выполнена ранее (idempotency).'
    : '✅ Доступ выдан, ученик уведомлён.';

  return { note, verificationLines: result.verificationLines };
}

async function rejectPurchaseRequest(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
  adminTelegramId: number,
): Promise<string> {
  if (request.status !== 'pending') return 'Заявка уже обработана.';

  await setPurchaseRequestStatus(admin, request.id, 'rejected', adminTelegramId);

  await telegramSend('sendMessage', {
    chat_id: request.telegram_id,
    text:
      `❌ Заявка отклонена\n\n` +
      `${request.title}\n\n` +
      `Если это ошибка — напишите администратору или оформите заявку заново в боте.`,
  });

  return '❌ Заявка отклонена, ученик уведомлён.';
}

export function isPurchasesAction(data: string): boolean {
  return data.startsWith('ap:');
}

export async function handlePurchasesAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  adminTelegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  try {
    if (data === 'ap:menu') {
      await renderPurchasesMenu(admin, deliver);
      return true;
    }

    if (data.startsWith('ap:f:')) {
      const [, , filterCode, pageRaw] = data.split(':');
      const filter: PurchaseFilter = filterCode === FILTER_ALL_CODE ? 'all' : 'pending';
      await renderPurchasesScreen(admin, deliver, filter, Math.max(0, Number(pageRaw) || 0));
      return true;
    }

    if (data.startsWith('ap:l:')) {
      const [, , id, filterCode, pageRaw] = data.split(':');
      const request = await getPurchaseRequest(admin, id);
      if (!request) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      const filter: PurchaseFilter = filterCode === FILTER_ALL_CODE ? 'all' : 'pending';
      await renderPurchaseDetail(admin, message, request, filter, Math.max(0, Number(pageRaw) || 0));
      return true;
    }

    if (data.startsWith('ap:ok:')) {
      const [, , id, filterCode, pageRaw] = data.split(':');
      const request = await getPurchaseRequest(admin, id);
      if (!request) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      const { note, verificationLines } = await approvePurchaseRequest(admin, request, adminTelegramId);
      const updated = await getPurchaseRequest(admin, id);
      if (!updated) {
        await deliver(note, { inline_keyboard: [[homeButton()]] });
        return true;
      }
      const filter: PurchaseFilter = filterCode === FILTER_ALL_CODE ? 'all' : 'pending';
      await renderPurchaseDetail(
        admin,
        message,
        updated,
        filter,
        Math.max(0, Number(pageRaw) || 0),
        verificationLines.length ? [note, '', ...verificationLines] : [note],
      );
      return true;
    }

    if (data.startsWith('ap:x:')) {
      const [, , id, filterCode, pageRaw] = data.split(':');
      const request = await getPurchaseRequest(admin, id);
      if (!request) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await rejectPurchaseRequest(admin, request, adminTelegramId);
      const updated = await getPurchaseRequest(admin, id);
      if (!updated) {
        await deliver('❌ Заявка отклонена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      const filter: PurchaseFilter = filterCode === FILTER_ALL_CODE ? 'all' : 'pending';
      await renderPurchaseDetail(admin, message, updated, filter, Math.max(0, Number(pageRaw) || 0));
      return true;
    }
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await deliver(migrationText('purchase_requests.sql'), homeOnlyKeyboard());
      return true;
    }
    console.error('[admin purchases]', error);
    await deliver('❌ Не удалось обработать заявку.\nПопробуйте ещё раз позже.', homeOnlyKeyboard());
    return true;
  }

  return false;
}
