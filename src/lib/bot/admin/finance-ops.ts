import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { telegramSend } from '@/lib/telegram';
import { buildPayStartPayload } from '../studentPurchaseFlow';
import { buildTrialPayTelegramUrl } from './lead-payments';
import { resolveMemberChatId } from '../staff/messaging';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  sendAdminMessage,
  shorten,
} from './core';
import {
  duePriority,
  fetchFinanceHubSnapshot,
  fetchReportSnapshot,
  formatPaymentDisplayId,
  getPayment,
  listDueItems,
  listPayments,
  listPendingPurchaseRequestsForDue,
  periodBounds,
  type PaymentRow,
} from './finance-data';
import { renderFinanceMenu } from './finance-menu';

const DUE_PER_PAGE = 10;
const PAY_PER_PAGE = 10;

function formatMoney(n: number): string {
  return `${n} BYN`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function memberName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data } = await admin.from('bot_members').select('full_name').eq('telegram_id', telegramId).maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name?.trim() || `ID ${telegramId}`;
}

function paymentTitle(p: PaymentRow): string {
  if (p.product === 'trial') return 'Пробное занятие';
  if (p.product === 'course') return 'Курс District';
  if (p.product === 'group') return 'Групповой пакет';
  if (p.product === 'individual') return 'Пакет занятий';
  return 'Оплата';
}

function statusEmoji(status: string | null): string {
  if (status === 'paid') return '🟢';
  if (status === 'failed') return '🔴';
  if (status === 'pending') return '⏳';
  if (status === 'cancelled') return '⚫';
  return '•';
}

function paginationRow(prefix: string, page: number, pageCount: number, extra = ''): InlineButton[] {
  const nav = (p: number) => `${prefix}:${p}${extra}`;
  const row: InlineButton[] = [];
  const windowSize = 3;
  let start = Math.max(0, page - 1);
  if (start + windowSize > pageCount) start = Math.max(0, pageCount - windowSize);
  for (let p = start; p < Math.min(pageCount, start + windowSize); p += 1) {
    row.push({ text: p === page ? `[${p + 1}]` : `${p + 1}`, callback_data: p === page ? 'noop' : nav(p) });
  }
  if (pageCount > start + windowSize) row.push({ text: '▶️', callback_data: nav(Math.min(pageCount - 1, page + 1)) });
  return row;
}

export function isFinanceAction(data: string): boolean {
  return data.startsWith('af:');
}

async function ensurePaymentExternalId(admin: SupabaseClient, payment: PaymentRow): Promise<string> {
  if (payment.external_id?.trim()) return payment.external_id.trim();
  const externalId = randomUUID().replace(/-/g, '').slice(0, 24);
  await admin.from('payments').update({ external_id: externalId }).eq('id', payment.id);
  return externalId;
}

async function paymentPayUrl(payment: PaymentRow, externalId: string): Promise<string> {
  if (payment.product === 'trial') return buildTrialPayTelegramUrl(externalId);
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const product = payment.product === 'course' ? 'course' : payment.product === 'group' ? 'group' : 'individual';
  const payload = buildPayStartPayload(product as 'course' | 'individual' | 'group', 0, 0);
  return username ? `https://t.me/${username}?start=${payload}` : payload;
}

export async function renderFinanceDueList(admin: SupabaseClient, deliver: Deliver, page: number): Promise<void> {
  const items = await listDueItems(admin);
  const purchasePending = await listPendingPurchaseRequestsForDue(admin);
  const total = items.length + purchasePending.length;
  const pageCount = Math.max(1, Math.ceil(total / DUE_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const from = safePage * DUE_PER_PAGE;

  const keyboard: InlineButton[][] = [];
  const pageItems = items.slice(from, from + DUE_PER_PAGE);
  for (const item of pageItems) {
    const name = await memberName(admin, item.payment.telegram_id);
    const emoji = item.priority === 'red' ? '🔴' : '🟡';
    keyboard.push([
      {
        text: `${emoji} ${shorten(name, 18)} · ${formatMoney(Number(item.payment.amount_byn))}`,
        callback_data: `af:due:l:${item.payment.id}:${safePage}`,
      },
    ]);
  }
  let idx = pageItems.length;
  for (const req of purchasePending.slice(Math.max(0, from - items.length), from - items.length + DUE_PER_PAGE - pageItems.length)) {
    if (idx >= DUE_PER_PAGE) break;
    const name = await memberName(admin, req.telegram_id);
    keyboard.push([
      {
        text: `🟡 ${shorten(name, 18)} · ${formatMoney(Number(req.amount_byn))}`,
        callback_data: `ap:l:${req.id}:p:${safePage}`,
      },
    ]);
    idx += 1;
  }

  if (pageCount > 1) keyboard.push(paginationRow('af:due', safePage, pageCount));
  keyboard.push([{ text: '⬅️ Финансы', callback_data: 'af:menu' }], [homeButton()]);

  await deliver(
    total === 0
      ? '💰 Требует оплаты\n\nСейчас нет ожидающих платежей.'
      : ['💰 Требует оплаты', '', `Всего: ${total}`].join('\n'),
    { inline_keyboard: keyboard },
  );
}

async function renderDuePaymentDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  payment: PaymentRow,
  page: number,
): Promise<void> {
  const name = await memberName(admin, payment.telegram_id);
  const failed = payment.status === 'failed';
  const lines = [
    '💰 Требует оплаты',
    '',
    `👤 ${name}`,
    '',
    paymentTitle(payment),
    '',
    '💰 Стоимость:',
    formatMoney(Number(payment.amount_byn)),
    '',
    'Статус:',
    failed ? '⚠️ Оплата не прошла' : '⏳ Ожидается оплата',
    '',
    `Создано:\n${formatDateTime(payment.created_at)}`,
  ];
  const keyboard: InlineButton[][] = [
    [{ text: '🔗 Отправить ссылку на оплату', callback_data: `af:due:send:${payment.id}:${page}` }],
    [{ text: '💬 Написать клиенту', callback_data: `admin:msg:w:${payment.telegram_id}` }],
    [{ text: '👤 Открыть клиента', callback_data: `admin:user:${payment.telegram_id}::` }],
    [{ text: '◀️ К списку', callback_data: `af:due:${page}` }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function sendDuePaymentLink(admin: SupabaseClient, paymentId: number, adminChatId: number): Promise<string> {
  const payment = await getPayment(admin, paymentId);
  if (!payment || (payment.status !== 'pending' && payment.status !== 'failed')) {
    return 'Платёж не найден или уже закрыт.';
  }
  const externalId = await ensurePaymentExternalId(admin, payment);
  const url = await paymentPayUrl(payment, externalId);
  const chatId = await resolveMemberChatId(admin, payment.telegram_id);
  if (!chatId) return 'У клиента нет chat_id в боте.';
  const text = [
    'Для продолжения обучения необходимо оплатить',
    paymentTitle(payment).toLowerCase() + '.',
    '',
    `💰 ${formatMoney(Number(payment.amount_byn))}`,
  ].join('\n');
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${formatMoney(Number(payment.amount_byn))}`, url }]] },
  });
  return '✅ Ссылка отправлена клиенту (тот же платёж, без дубликата).';
}

export async function renderFinancePaymentsHub(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const { fromIso, toIso } = periodBounds('today');
  const snap = await fetchReportSnapshot(admin, fromIso, toIso);
  const text = [
    '💳 Платежи',
    '',
    '📊 Сегодня',
    '',
    `💰 Получено: ${formatMoney(snap.received)}`,
    `🧾 Платежей: ${snap.paidCount}`,
    '',
    `⏳ Ожидают: ${snap.pendingCount}`,
    `⚠️ Проблемных: ${snap.failedCount}`,
  ].join('\n');
  await deliver(text, {
    inline_keyboard: [
      [{ text: '📅 Сегодня', callback_data: 'af:pay:f:all:0:today' }],
      [{ text: '📆 Все', callback_data: 'af:pay:f:all:0' }],
      [
        { text: '🟢 Оплачены', callback_data: 'af:pay:f:paid:0' },
        { text: '⏳ Ожидают', callback_data: 'af:pay:f:pending:0' },
      ],
      [{ text: '🔴 Не прошли', callback_data: 'af:pay:f:failed:0' }],
      [{ text: '⬅️ Финансы', callback_data: 'af:menu' }],
      [homeButton()],
    ],
  });
}

export async function renderFinancePaymentsList(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: string,
  page: number,
  period?: string,
): Promise<void> {
  let rows: PaymentRow[] = [];
  if (period === 'today') {
    const { fromIso, toIso } = periodBounds('today');
    rows = await listPayments(admin, { fromIso, toIso, limit: 200 });
  } else if (filter === 'paid') rows = await listPayments(admin, { status: 'paid', limit: 200 });
  else if (filter === 'pending') rows = await listPayments(admin, { status: 'pending', limit: 200 });
  else if (filter === 'failed') rows = await listPayments(admin, { status: 'failed', limit: 200 });
  else rows = await listPayments(admin, { limit: 200 });

  const pageCount = Math.max(1, Math.ceil(rows.length / PAY_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = rows.slice(safePage * PAY_PER_PAGE, (safePage + 1) * PAY_PER_PAGE);
  const keyboard: InlineButton[][] = slice.map((p) => [
    {
      text: `${statusEmoji(p.status)} ${formatMoney(Number(p.amount_byn))} · ${shorten(paymentTitle(p), 16)}`,
      callback_data: `af:pay:l:${p.id}:${filter}:${safePage}`,
    },
  ]);
  if (pageCount > 1) keyboard.push(paginationRow(`af:pay:f:${filter}`, safePage, pageCount, period === 'today' ? ':today' : ''));
  keyboard.push([{ text: '⬅️ Платежи', callback_data: 'af:pay:menu' }], [homeButton()]);

  const lines = ['💳 Платежи', ''];
  for (const p of slice) {
    const name = await memberName(admin, p.telegram_id);
    lines.push(`${statusEmoji(p.status)} ${name}`, paymentTitle(p), formatMoney(Number(p.amount_byn)), formatDateTime(p.created_at), '');
  }
  await deliver(lines.join('\n').trim() || '💳 Платежи\n\nПусто.', { inline_keyboard: keyboard });
}

async function renderPaymentDetail(admin: SupabaseClient, message: AdminMessage, payment: PaymentRow, back: string): Promise<void> {
  const name = await memberName(admin, payment.telegram_id);
  const lines = [
    '💳 Платёж',
    '',
    `👤 ${name}`,
    '',
    paymentTitle(payment),
    '',
    '💰 Сумма:',
    formatMoney(Number(payment.amount_byn)),
    '',
    `Статус:\n${statusEmoji(payment.status)} ${payment.status ?? '—'}`,
    '',
    payment.provider ? `Способ:\n${payment.provider === 'acquiring' ? 'Эквайринг' : payment.provider}` : '',
    '',
    `Создан:\n${formatDateTime(payment.created_at)}`,
    payment.paid_at ? `\nОплачен:\n${formatDateTime(payment.paid_at)}` : '',
    '',
    `ID: ${formatPaymentDisplayId(payment.id)}`,
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [[{ text: '👤 Открыть клиента', callback_data: `admin:user:${payment.telegram_id}::` }]];
  if (payment.package_id) keyboard.push([{ text: '📦 Открыть пакет', callback_data: `apk:p:${payment.package_id}:a:0` }]);
  if (payment.lead_id) keyboard.push([{ text: '📨 Открыть заявку', callback_data: `al:l:${payment.lead_id}:w:0` }]);
  keyboard.push([{ text: '◀️ Назад', callback_data: back }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function renderFinanceReports(admin: SupabaseClient, deliver: Deliver, preset: 'today' | '7d' | '30d' | 'month'): Promise<void> {
  const { fromIso, toIso, label } = periodBounds(preset);
  const snap = await fetchReportSnapshot(admin, fromIso, toIso);
  const avg = snap.paidCount > 0 ? snap.received / snap.paidCount : 0;
  await deliver(
    [
      '📊 Финансовые отчёты',
      '',
      `📅 Период: ${label}`,
      '',
      `💰 Получено: ${formatMoney(snap.received)}`,
      `🧾 Платежей: ${snap.paidCount}`,
      `📦 Пакетов продано: ${snap.packagesSold}`,
      `🎓 Пробных (сумма): ${formatMoney(snap.trialPaid)}`,
      '',
      `⏳ Ожидают оплаты: ${snap.pendingCount}`,
      `⚠️ Неуспешных: ${snap.failedCount}`,
      '',
      '💰 Доход',
      `📦 Пакеты — ${formatMoney(snap.packagePaid)}`,
      `🎓 Пробные — ${formatMoney(snap.trialPaid)}`,
      snap.paidCount > 0 ? `\nСредний платёж: ${avg.toFixed(2)} BYN` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    {
      inline_keyboard: [
        [
          { text: 'Сегодня', callback_data: 'af:rep:today' },
          { text: '7 дней', callback_data: 'af:rep:7d' },
        ],
        [
          { text: '30 дней', callback_data: 'af:rep:30d' },
          { text: 'Месяц', callback_data: 'af:rep:month' },
        ],
        [{ text: '💰 Требует оплаты', callback_data: 'af:due:0' }],
        [{ text: '⬅️ Финансы', callback_data: 'af:menu' }],
        [homeButton()],
      ],
    },
  );
}

export async function handleFinanceAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  if (data === 'af:menu') {
    await renderFinanceMenu(admin, deliver);
    return true;
  }

  if (data === 'af:pay:menu') {
    await renderFinancePaymentsHub(admin, deliver);
    return true;
  }

  if (data.startsWith('af:due:send:')) {
    const parts = data.split(':');
    const paymentId = Number(parts[3]);
    const page = Number(parts[4]) || 0;
    const result = await sendDuePaymentLink(admin, paymentId, message.chatId);
    await sendAdminMessage(message.chatId, result, {
      inline_keyboard: [[{ text: '◀️ К платежу', callback_data: `af:due:l:${paymentId}:${page}` }], [homeButton()]],
    });
    return true;
  }

  if (data.startsWith('af:due:l:')) {
    const parts = data.split(':');
    const paymentId = Number(parts[3]);
    const page = Number(parts[4]) || 0;
    const payment = await getPayment(admin, paymentId);
    if (!payment) {
      await deliver('Платёж не найден.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    await renderDuePaymentDetail(admin, message, payment, page);
    return true;
  }

  if (data.startsWith('af:due:')) {
    const page = Number(data.split(':')[2]) || 0;
    await renderFinanceDueList(admin, deliver, page);
    return true;
  }

  if (data.startsWith('af:pay:l:')) {
    const parts = data.split(':');
    const id = Number(parts[3]);
    const filter = parts[4] ?? 'all';
    const page = Number(parts[5]) || 0;
    const payment = await getPayment(admin, id);
    if (!payment) {
      await deliver('Платёж не найден.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    await renderPaymentDetail(admin, message, payment, `af:pay:f:${filter}:${page}`);
    return true;
  }

  if (data.startsWith('af:pay:f:')) {
    const parts = data.slice('af:pay:f:'.length).split(':');
    const filter = parts[0] ?? 'all';
    const page = Number(parts[1]) || 0;
    const period = parts[2];
    await renderFinancePaymentsList(admin, deliver, filter, page, period);
    return true;
  }

  if (data.startsWith('af:rep:')) {
    const preset = data.slice('af:rep:'.length) as 'today' | '7d' | '30d' | 'month';
    const safe = preset === '7d' || preset === '30d' || preset === 'month' ? preset : 'today';
    await renderFinanceReports(admin, deliver, safe);
    return true;
  }

  void actorTelegramId;
  return false;
}
