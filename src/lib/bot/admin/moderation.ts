import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  getMember,
  getModerationInfo,
  listMembersByModeration,
  roleLabel,
  searchMembers,
  setModerationStatus,
} from '@/lib/bot/roles';
import { formatMsgDisplayId } from '@/lib/displayId';
import { staffStudentLabel } from '@/lib/bot/staff/messaging';
import {
  RISK_EMOJI,
  RISK_TITLE,
  STATUS_LABEL,
  VIOLATIONS_PER_PAGE,
  type UserViolationStats,
  type ViolationRisk,
  type ViolationRow,
  countViolations,
  formatViolationDateShort,
  formatViolationDateTime,
  getViolation,
  getUserViolationStats,
  isModerationColumnError,
  isViolationTableError,
  listViolations,
  reviewViolation,
  sendWarningToUser,
  violationSenderName,
} from '@/lib/bot/moderation';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  USERS_PER_PAGE,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  isConversationStateTableError,
  migrationText,
  saveState,
  sendAdminMessage,
  shorten,
} from './core';
import { memberCard, memberDisplayName } from './users';

// ---------------------------------------------------------------------------
// Контроль переписки
// ---------------------------------------------------------------------------

// Обнаружение, учёт и ручная обработка событий. Автоматических санкций
// нет: предупреждение, ограничение и блокировку применяет администратор.
// Блокировка реальная и обратимая — статус в bot_members.moderation_status.

// Откуда открыта карточка события: n — новые, a — все, u — нарушения
// пользователя, w — предупреждения, x — уведомление в чате администратора.
type ModerationContext = {
  origin: 'n' | 'r' | 'a' | 'u' | 'w' | 'x';
  filter: string;
  telegramId: number;
  page: number;
};

function commsThreadStaffRole(senderRole: string): 'teacher' | 'curator' {
  return senderRole === 'teacher' ? 'teacher' : 'curator';
}

const MODERATION_RISK_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'high', label: '🔴 HIGH' },
  { id: 'medium', label: '🟠 MEDIUM' },
  { id: 'low', label: '🟡 LOW' },
];

function toModerationPage(raw?: string): number {
  return Math.max(0, Number(raw) || 0);
}

function normalizeRiskFilter(raw?: string): string {
  return MODERATION_RISK_FILTERS.some((item) => item.id === raw) ? (raw as string) : 'all';
}

async function renderModerationMigrationMessage(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, migrationText('bot_moderation.sql'), homeOnlyKeyboard());
}

// Строка списка событий: риск, имя, роль и время.
function violationItemText(row: ViolationRow): string {
  return [
    `${RISK_EMOJI[row.risk_level]} ${violationSenderName(row)}`,
    `🎭 ${roleLabel(row.sender_role)}`,
    `🕐 ${formatViolationDateShort(row.created_at)}`,
  ].join('\n');
}

// Строка истории нарушений пользователя: риск, дата, причина, статус.
function violationHistoryItemText(row: ViolationRow): string {
  return [
    `${RISK_EMOJI[row.risk_level]} ${RISK_TITLE[row.risk_level]}`,
    formatViolationDateShort(row.created_at),
    '',
    'Причина:',
    row.reason,
    '',
    'Статус:',
    STATUS_LABEL[row.status],
  ].join('\n');
}

// Единая строка пагинации [⬅️][N/M][➡️]; null, если страница одна.
function moderationPaginationRow(
  pageCount: number,
  safePage: number,
  buildCallback: (page: number) => string,
): InlineButton[] | null {
  if (pageCount <= 1) return null;
  return [
    {
      text: safePage > 0 ? '⬅️' : '·',
      callback_data: safePage > 0 ? buildCallback(safePage - 1) : 'noop',
    },
    { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
    {
      text: safePage < pageCount - 1 ? '➡️' : '·',
      callback_data: safePage < pageCount - 1 ? buildCallback(safePage + 1) : 'noop',
    },
  ];
}

function serializeModerationContext(context: ModerationContext): string {
  if (context.origin === 'a') return `a:${context.filter}:${context.page}`;
  if (context.origin === 'u') return `u:${context.telegramId}:${context.page}`;
  if (context.origin === 'w') return `w:${context.page}`;
  if (context.origin === 'r') return `r:${context.page}`;
  if (context.origin === 'x') return 'x';
  return `n:${context.page}`;
}

function parseModerationContext(parts: string[]): ModerationContext {
  const origin = parts[0] ?? 'n';
  if (origin === 'a') {
    return { origin: 'a', filter: normalizeRiskFilter(parts[1]), telegramId: 0, page: toModerationPage(parts[2]) };
  }
  if (origin === 'u') {
    return { origin: 'u', filter: 'all', telegramId: Number(parts[1]) || 0, page: toModerationPage(parts[2]) };
  }
  if (origin === 'w') {
    return { origin: 'w', filter: 'all', telegramId: 0, page: toModerationPage(parts[1]) };
  }
  if (origin === 'x') return { origin: 'x', filter: 'all', telegramId: 0, page: 0 };
  if (origin === 'r') return { origin: 'r', filter: 'all', telegramId: 0, page: toModerationPage(parts[1]) };
  return { origin: 'n', filter: 'all', telegramId: 0, page: toModerationPage(parts[1]) };
}

function moderationBackButton(context: ModerationContext): InlineButton {
  if (context.origin === 'a') {
    return { text: '⬅️ Назад', callback_data: `admin:mod:all:${context.filter}:${context.page}` };
  }
  if (context.origin === 'u') {
    return { text: '⬅️ Назад', callback_data: `admin:mod:usr:${context.telegramId}:${context.page}` };
  }
  if (context.origin === 'w') {
    return { text: '⬅️ Назад', callback_data: `admin:mod:warned:${context.page}` };
  }
  if (context.origin === 'x') {
    return { text: '⬅️ Назад', callback_data: 'admin:chat-control' };
  }
  if (context.origin === 'r') {
    return { text: '⬅️ Назад', callback_data: `admin:mod:review:${context.page}` };
  }
  return { text: '⬅️ Назад', callback_data: `admin:mod:new:${context.page}` };
}

// Меню контроля: из Reply Keyboard — новое сообщение, из inline-навигации — edit.
export async function renderModerationMenu(
  admin: SupabaseClient,
  telegramId: number,
  deliver: Deliver,
): Promise<void> {
  // Вне активного поиска текст админа не должен попадать в поиск нарушителей.
  await clearStateIfAvailable(admin, telegramId);
  try {
    const [pendingHigh, pendingReview] = await Promise.all([
      countViolations(admin, { status: 'pending', risk: 'high' }),
      countViolations(admin, { status: 'pending', riskIn: ['low', 'medium'] }),
    ]);
    const text = [
      '💬 Контроль переписки',
      '',
      `🔴 Новые (HIGH) — ${pendingHigh}`,
      `🟡 На проверке — ${pendingReview}`,
      '',
      pendingHigh + pendingReview > 0 ? 'Есть необработанные события.' : '✅ Новых нарушений нет.',
    ].join('\n');
    await deliver(text, {
      inline_keyboard: [
        [{ text: '🔴 Новые', callback_data: 'admin:mod:new:0' }],
        [{ text: '🟡 На проверке', callback_data: 'admin:mod:review:0' }],
        [{ text: '📋 Все', callback_data: 'admin:mod:all:all:0' }],
        [{ text: '👤 Пользователи под контролем', callback_data: 'admin:mod:users' }],
        [{ text: '⚠️ Предупреждения', callback_data: 'admin:mod:warned:0' }],
        [{ text: '🔒 Заблокированные', callback_data: 'admin:mod:blocked:0' }],
        [{ text: '⬅️ Проблемы и контроль', callback_data: 'ah:more:problems-control' }],
        [homeButton()],
      ],
    });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await deliver(migrationText('bot_moderation.sql'), homeOnlyKeyboard());
  }
}

// Только события со статусом pending.
async function renderModerationNew(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  try {
    const { rows, total } = await listViolations(admin, { status: 'pending', risk: 'high' }, page);
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${RISK_EMOJI[row.risk_level]} ${shorten(violationSenderName(row), 28)}`,
        callback_data: `admin:mod:v:${row.id}:n:${safePage}`,
      },
    ]);
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:new:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }], [homeButton()]);

    const text =
      rows.length === 0
        ? '🚨 Новые нарушения (HIGH)\n\nНеобработанных событий нет.'
        : ['🚨 Новые нарушения (HIGH)', '', ...rows.map(violationItemText)].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Pending с риском LOW/MEDIUM — без автоблокировки сообщения.
async function renderModerationReview(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  try {
    const { rows, total } = await listViolations(
      admin,
      { status: 'pending', riskIn: ['low', 'medium'] },
      page,
    );
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${RISK_EMOJI[row.risk_level]} ${shorten(violationSenderName(row), 28)}`,
        callback_data: `admin:mod:v:${row.id}:r:${safePage}`,
      },
    ]);
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:review:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }], [homeButton()]);

    const text =
      rows.length === 0
        ? '🟡 На проверке\n\nСобытий в очереди нет.'
        : ['🟡 На проверке', '', ...rows.map(violationItemText)].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// История всех событий с фильтром по уровню риска.
async function renderModerationAll(
  admin: SupabaseClient,
  message: AdminMessage,
  filter: string,
  page: number,
): Promise<void> {
  try {
    const violationFilter = filter === 'all' ? {} : { risk: filter as ViolationRisk };
    const { rows, total } = await listViolations(admin, violationFilter, page);
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${RISK_EMOJI[row.risk_level]} ${shorten(violationSenderName(row), 22)} — ${RISK_TITLE[row.risk_level]}`,
        callback_data: `admin:mod:v:${row.id}:a:${filter}:${safePage}`,
      },
    ]);
    keyboard.push(
      MODERATION_RISK_FILTERS.map((item) => ({
        text: item.id === filter ? `✅ ${item.label}` : item.label,
        callback_data: `admin:mod:all:${item.id}:0`,
      })),
    );
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:all:${filter}:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }], [homeButton()]);

    const text =
      rows.length === 0
        ? '📋 Все нарушения\n\nСобытий не найдено.'
        : ['📋 Все нарушения', '', ...rows.map(violationItemText)].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Шаг «Пользователи под контролем»: запрос имени/телефона.
async function renderModerationUsersPrompt(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  try {
    await saveState(admin, telegramId, message, 'moderation:search', {});
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await editAdminMessage(message, migrationText('bot_conversation_states.sql'), homeOnlyKeyboard());
    return;
  }
  await editAdminMessage(
    message,
    '👤 Пользователи под контролем\n\nОтправь следующим сообщением имя, часть имени или телефон пользователя — покажу его счётчики и историю событий.',
    {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }],
        [homeButton()],
      ],
    },
  );
}

// Результаты поиска — ответ на текстовый ввод: всегда новое сообщение.
export async function renderModerationSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const chatId = state.chat_id;
  const backKeyboard: InlineButton[][] = [
    [{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }],
    [homeButton()],
  ];

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    await sendAdminMessage(
      chatId,
      '👤 Пользователи под контролем\n\nЗапрос слишком короткий — введи минимум 2 символа.',
      { inline_keyboard: backKeyboard },
    );
    return;
  }

  const members = await searchMembers(admin, trimmed, 10);
  if (members.length === 0) {
    await sendAdminMessage(
      chatId,
      `👤 Никого не нашли по запросу «${trimmed}». Новый запрос — просто отправь его сообщением.`,
      { inline_keyboard: backKeyboard },
    );
    return;
  }

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 28)} · ${roleLabel(member.role)}`,
      callback_data: `admin:mod:usr:${member.telegram_id}:0`,
    },
  ]);
  keyboard.push(...backKeyboard);

  await sendAdminMessage(
    chatId,
    `👤 Результаты по запросу «${trimmed}»: ${members.length}\n\nВыбери пользователя, чтобы посмотреть его события. Новый запрос — просто отправь его сообщением.`,
    { inline_keyboard: keyboard },
  );
}

// Все события конкретного пользователя + счётчики.
async function renderUserViolations(
  admin: SupabaseClient,
  message: AdminMessage,
  targetId: number,
  page: number,
): Promise<void> {
  try {
    const member = await getMember(admin, targetId);
    const { rows, total } = await listViolations(admin, { telegramId: targetId }, page);
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    // Счётчики считаются по истории bot_violations.
    let stats: UserViolationStats | null = null;
    try {
      stats = await getUserViolationStats(admin, targetId);
    } catch (statsError) {
      if (!isViolationTableError(statsError)) throw statsError;
    }

    let moderationStatus = 'active';
    try {
      const info = await getModerationInfo(admin, targetId);
      moderationStatus = info?.moderationStatus ?? 'active';
    } catch (statusError) {
      if (!isModerationColumnError(statusError)) throw statusError;
    }

    const headerLines = [member ? memberCard(member) : `👤 ID ${targetId}`];
    if (stats) {
      headerLines.push(
        `🚨 Нарушений: ${stats.total}`,
        `⚠️ Предупреждений: ${stats.warnings}`,
        `🚫 Ограничений: ${stats.restrictions}`,
        `🔒 Блокировок: ${stats.blocks}`,
      );
    } else {
      headerLines.push(`📌 Событий: ${total}`);
    }
    if (moderationStatus === 'blocked') headerLines.push('', '🔒 Пользователь заблокирован.');
    if (moderationStatus === 'restricted') headerLines.push('', '🚫 Пользователь ограничен.');

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${RISK_EMOJI[row.risk_level]} ${RISK_TITLE[row.risk_level]} · ${formatViolationDateShort(row.created_at)}`,
        callback_data: `admin:mod:v:${row.id}:u:${targetId}:${safePage}`,
      },
    ]);
    if (moderationStatus === 'blocked') {
      keyboard.push([{ text: '🔓 Разблокировать', callback_data: `admin:mod:unblock:${targetId}` }]);
    }
    if (moderationStatus === 'restricted') {
      keyboard.push([{ text: '🔓 Снять ограничение', callback_data: `admin:mod:unrestrict:${targetId}` }]);
    }
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:usr:${targetId}:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:mod:users' }], [homeButton()]);

    const text =
      rows.length === 0
        ? ['📋 История нарушений', '', headerLines.join('\n'), '', 'Событий пока нет.'].join('\n\n')
        : ['📋 История нарушений', '', headerLines.join('\n'), '', ...rows.map(violationHistoryItemText)].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

async function renderStudentViolationHistory(
  admin: SupabaseClient,
  message: AdminMessage,
  studentId: number,
  page: number,
): Promise<void> {
  try {
    const label = await staffStudentLabel(admin, studentId);
    const { rows, total } = await listViolations(admin, { involvedStudentId: studentId }, page);
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${formatMsgDisplayId(row.id)} · ${formatViolationDateShort(row.created_at)}`,
        callback_data: `admin:mod:v:${row.id}:x`,
      },
    ]);
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:std:${studentId}:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Контроль', callback_data: 'admin:chat-control' }], [homeButton()]);

    const text =
      rows.length === 0
        ? ['💬 История нарушений', '', `👨‍🎓 ${label}`, '', 'Событий нет.'].join('\n')
        : [
            '💬 История нарушений',
            '',
            `👨‍🎓 ${label}`,
            `Всего: ${total}`,
            '',
            ...rows.map((row) => {
              const type = row.violation_type.startsWith('phone') ? '📱 телефон' : '🔗 Telegram';
              return `${formatViolationDateShort(row.created_at)} — ${type}`;
            }),
          ].join('\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Полная карточка события с кнопками обработки.
async function renderViolationDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  violationId: number,
  context: ModerationContext,
): Promise<void> {
  try {
    const row = await getViolation(admin, violationId);
    if (!row) {
      await editAdminMessage(message, `Нарушение #${violationId} не найдено.`, {
        inline_keyboard: [[moderationBackButton(context)], [homeButton()]],
      });
      return;
    }

    let recipientLine = 'Бот District (личный чат)';
    if (row.recipient_telegram_id) {
      try {
        recipientLine = await staffStudentLabel(admin, row.recipient_telegram_id);
      } catch {
        recipientLine = `Ученик ${row.recipient_telegram_id}`;
      }
    }

    const detectedType = row.violation_type.startsWith('phone') ? '📱 Номер телефона' : '🔗 Telegram / контакт';

    const lines = [
      `💬 Нарушение ${formatMsgDisplayId(row.id)}`,
      '',
      `👨‍🏫 ${violationSenderName(row)}`,
      row.recipient_telegram_id ? `👨‍🎓 ${recipientLine}` : '',
      '',
      `🕐 ${formatViolationDateTime(row.created_at)}`,
      '',
      'Тип:',
      detectedType,
      '',
      'Сообщение:',
      `«${shorten(row.message_text, 2000)}»`,
      '',
      'Действие:',
      row.status === 'pending' && row.risk_level === 'high' ? '🚫 Сообщение заблокировано' : 'Зафиксировано',
      '',
      'Статус:',
      row.status === 'pending' ? '🔴 Новое' : STATUS_LABEL[row.status],
    ].filter((line) => line !== '');

    if (row.status !== 'pending' && row.action_at) {
      lines.push(
        '',
        `Обработал: администратор ${row.action_by ?? '—'} · ${formatViolationDateTime(row.action_at)}`,
      );
    }
    if (row.status === 'warned') {
      lines.push('', '⚠️ Пользователю отправлено предупреждение.');
    }
    if (row.status === 'restricted') {
      lines.push('', '🚫 Пользователь ограничен.');
    }
    if (row.status === 'blocked') {
      lines.push('', '🔒 Пользователь заблокирован.');
    }

    let staffStats: UserViolationStats | null = null;
    try {
      staffStats = await getUserViolationStats(admin, row.telegram_id);
    } catch {
      staffStats = null;
    }
    if (staffStats && staffStats.total > 1) {
      lines.push('', `📊 Нарушений у отправителя: ${staffStats.total}`);
    }

    const keyboard: InlineButton[][] = [];
    if (row.status === 'pending') {
      const contextSuffix = serializeModerationContext(context);
      keyboard.push(
        [{ text: '⚠️ Предупредить', callback_data: `admin:mod:act:warn:${row.id}:${contextSuffix}` }],
        [
          { text: '🚫 Ограничить', callback_data: `admin:mod:act:restrict:${row.id}:${contextSuffix}` },
          { text: '🔒 Заблокировать', callback_data: `admin:mod:act:block:${row.id}:${contextSuffix}` },
        ],
        [{ text: '✅ Обработано', callback_data: `admin:mod:act:ignore:${row.id}:${contextSuffix}` }],
      );
    }
    if (row.recipient_telegram_id) {
      const staffRole = commsThreadStaffRole(row.sender_role);
      keyboard.push([
        {
          text: '👁 Открыть переписку',
          callback_data: `ah:msg:t:${row.recipient_telegram_id}:${row.telegram_id}:${staffRole}:0`,
        },
      ]);
    }
    keyboard.push([{ text: '📜 История сотрудника', callback_data: `admin:mod:usr:${row.telegram_id}:0` }]);
    if (row.recipient_telegram_id) {
      keyboard.push([
        {
          text: '📜 История ученика',
          callback_data: `admin:mod:std:${row.recipient_telegram_id}:0`,
        },
      ]);
    }
    keyboard.push([moderationBackButton(context)], [homeButton()]);

    await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Подтверждение блокировки: счётчики берутся из истории нарушений.
async function renderBlockConfirm(
  admin: SupabaseClient,
  message: AdminMessage,
  row: ViolationRow,
  context: ModerationContext,
): Promise<void> {
  let stats: UserViolationStats | null = null;
  try {
    stats = await getUserViolationStats(admin, row.telegram_id);
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
  }

  const contextSuffix = serializeModerationContext(context);
  await editAdminMessage(
    message,
    [
      '🔒 Заблокировать пользователя?',
      '',
      `👤 ${violationSenderName(row)}`,
      `🎭 ${roleLabel(row.sender_role)}`,
      '',
      `Нарушений: ${stats?.total ?? 0}`,
      `Предупреждений: ${stats?.warnings ?? 0}`,
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '🔒 Да, заблокировать', callback_data: `admin:mod:act:blockyes:${row.id}:${contextSuffix}` }],
        [moderationBackButton(context)],
        [homeButton()],
      ],
    },
  );
}

type ModerationAction = 'warn' | 'restrict' | 'block' | 'blockyes' | 'ignore';

const MODERATION_ACTIONS: ModerationAction[] = ['warn', 'restrict', 'block', 'blockyes', 'ignore'];

// Обработка события администратором:
// warn → warned + сообщение пользователю, restrict → restricted + статус в
// bot_members, block → подтверждение, blockyes → blocked + статус, ignore →
// ignored без санкций.
async function applyModerationAction(
  admin: SupabaseClient,
  message: AdminMessage,
  adminTelegramId: number,
  action: ModerationAction,
  violationId: number,
  context: ModerationContext,
): Promise<void> {
  try {
    const row = await getViolation(admin, violationId);
    if (!row) {
      await editAdminMessage(message, `Нарушение #${violationId} не найдено.`, {
        inline_keyboard: [[moderationBackButton(context)], [homeButton()]],
      });
      return;
    }

    // Перед блокировкой всегда показываем подтверждение со счётчиками.
    if (action === 'block') {
      await renderBlockConfirm(admin, message, row, context);
      return;
    }

    // Повторное нажатие по уже обработанному событию ничего не меняет.
    let extraNote = '';
    if (row.status === 'pending') {
      if (action === 'warn') {
        await reviewViolation(admin, violationId, 'warned', adminTelegramId);
        try {
          const stats = await getUserViolationStats(admin, row.telegram_id);
          await sendWarningToUser(row.chat_id, stats.warnings);
          extraNote = '⚠️ Пользователю отправлено предупреждение.';
        } catch (noticeError) {
          console.error('Контроль переписки: не удалось отправить предупреждение:', noticeError);
          extraNote = '⚠️ Предупреждение сохранено, но сообщение пользователю не доставлено.';
        }
      } else if (action === 'restrict') {
        await reviewViolation(admin, violationId, 'restricted', adminTelegramId);
        await setModerationStatus(admin, row.telegram_id, 'restricted', adminTelegramId);
        extraNote = '🚫 Пользователь ограничен.';
      } else if (action === 'blockyes') {
        await reviewViolation(admin, violationId, 'blocked', adminTelegramId);
        await setModerationStatus(admin, row.telegram_id, 'blocked', adminTelegramId);
        extraNote = '🔒 Пользователь заблокирован.';
      } else {
        await reviewViolation(admin, violationId, 'ignored', adminTelegramId);
        extraNote = '✅ Нарушение закрыто без санкций.';
      }
    }

    const newStatus =
      action === 'warn' ? 'warned' : action === 'restrict' ? 'restricted' : action === 'blockyes' ? 'blocked' : 'ignored';

    // Действие из уведомления в чате: подтверждаем прямо в этом сообщении,
    // администратор не должен неожиданно оказываться в другом разделе.
    if (context.origin === 'x') {
      const lines = [`✅ Событие #${violationId} обработано.`, '', `Статус: ${STATUS_LABEL[newStatus]}`];
      if (extraNote) lines.push('', extraNote);
      lines.push('', 'Подробности — в разделе «Контроль переписки».');
      await editAdminMessage(message, lines.join('\n'), {
        inline_keyboard: [
          [{ text: '🚨 К контролю переписки', callback_data: 'admin:chat-control' }],
          [homeButton()],
        ],
      });
      return;
    }

    await renderViolationDetail(admin, message, violationId, context);
  } catch (error) {
    if (!isModerationColumnError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// События, по которым администратор отправил предупреждение.
async function renderModerationWarned(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  try {
    const { rows, total } = await listViolations(admin, { status: 'warned' }, page);
    const pageCount = Math.max(1, Math.ceil(total / VIOLATIONS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      {
        text: `${RISK_EMOJI[row.risk_level]} ${shorten(violationSenderName(row), 28)}`,
        callback_data: `admin:mod:v:${row.id}:w:${safePage}`,
      },
    ]);
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:warned:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }], [homeButton()]);

    const text =
      rows.length === 0
        ? '⚠️ Предупреждения\n\nСобытий с предупреждениями нет.'
        : ['⚠️ Предупреждения', '', ...rows.map(violationItemText)].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Пользователи со статусом blocked. Данные берутся из bot_members.
async function renderModerationBlocked(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  try {
    const { members, total } = await listMembersByModeration(admin, 'blocked', page, USERS_PER_PAGE);
    const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = members.map((member) => [
      {
        text: `👤 ${shorten(memberDisplayName(member), 28)} · ${roleLabel(member.role)}`,
        callback_data: `admin:mod:usr:${member.telegram_id}:0`,
      },
    ]);
    const pagination = moderationPaginationRow(pageCount, safePage, (p) => `admin:mod:blocked:${p}`);
    if (pagination) keyboard.push(pagination);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:chat-control' }], [homeButton()]);

    const items = members.map((member) =>
      [
        `👤 ${memberDisplayName(member)}`,
        `🎭 ${roleLabel(member.role)}`,
        member.blocked_at ? `🕐 ${formatViolationDateTime(member.blocked_at)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const text =
      members.length === 0
        ? '🔒 Заблокированные\n\nЗаблокированных пользователей нет.'
        : ['🔒 Заблокированные', '', ...items].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isModerationColumnError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

// Разблокировка и снятие ограничения: статус возвращается в active,
// служебные отметки очищаются, пользователь получает уведомление.
async function applyModerationRestore(
  admin: SupabaseClient,
  message: AdminMessage,
  adminTelegramId: number,
  targetId: number,
  kind: 'unblock' | 'unrestrict',
): Promise<void> {
  try {
    const restored = await setModerationStatus(admin, targetId, 'active', adminTelegramId);
    const member = restored ? await getMember(admin, targetId) : null;
    if (member?.chat_id) {
      try {
        await telegramSend('sendMessage', {
          chat_id: member.chat_id,
          text:
            kind === 'unblock'
              ? '🔓 Доступ к боту District восстановлен.'
              : '🔓 Ограничения на общение в боте District сняты.',
        });
      } catch (noticeError) {
        console.error('Контроль переписки: не удалось отправить уведомление о разблокировке:', noticeError);
      }
    }
    const name = member ? memberDisplayName(member) : `ID ${targetId}`;
    await editAdminMessage(
      message,
      restored
        ? kind === 'unblock'
          ? `🔓 Пользователь ${name} разблокирован. Статус возвращён в active.`
          : `🔓 Ограничение снято: ${name} снова может пользоваться ботом в полном объёме.`
        : 'Пользователь не найден.',
      {
        inline_keyboard: [
          [{ text: '👤 К карточке пользователя', callback_data: `admin:mod:usr:${targetId}:0` }],
          [{ text: '🔒 Заблокированные', callback_data: 'admin:mod:blocked:0' }],
          [homeButton()],
        ],
      },
    );
  } catch (error) {
    if (!isModerationColumnError(error)) throw error;
    await renderModerationMigrationMessage(message);
  }
}

export async function handleModerationAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  try {
    if (data === 'admin:chat-control' || data === 'admin:mod') {
      await renderModerationMenu(admin, telegramId, editDeliver(message));
      return true;
    }

    const parts = data.split(':');
    const section = parts[2] ?? '';

    if (section === 'new') {
      await renderModerationNew(admin, message, toModerationPage(parts[3]));
      return true;
    }
    if (section === 'review') {
      await renderModerationReview(admin, message, toModerationPage(parts[3]));
      return true;
    }
    if (section === 'all') {
      await renderModerationAll(admin, message, normalizeRiskFilter(parts[3]), toModerationPage(parts[4]));
      return true;
    }
    if (section === 'users') {
      await renderModerationUsersPrompt(admin, telegramId, message);
      return true;
    }
    if (section === 'warned') {
      await renderModerationWarned(admin, message, toModerationPage(parts[3]));
      return true;
    }
    if (section === 'blocked') {
      await renderModerationBlocked(admin, message, toModerationPage(parts[3]));
      return true;
    }
    if (section === 'unblock' || section === 'unrestrict') {
      const targetId = Number(parts[3]) || 0;
      if (targetId > 0) {
        await applyModerationRestore(admin, message, telegramId, targetId, section);
      } else {
        await renderModerationMenu(admin, telegramId, editDeliver(message));
      }
      return true;
    }
    if (section === 'usr') {
      const targetId = Number(parts[3]) || 0;
      if (targetId > 0) {
        await renderUserViolations(admin, message, targetId, toModerationPage(parts[4]));
      } else {
        await renderModerationMenu(admin, telegramId, editDeliver(message));
      }
      return true;
    }
    if (section === 'std') {
      const studentId = Number(parts[3]) || 0;
      if (studentId > 0) {
        await renderStudentViolationHistory(admin, message, studentId, toModerationPage(parts[4]));
      } else {
        await renderModerationMenu(admin, telegramId, editDeliver(message));
      }
      return true;
    }
    if (section === 'v') {
      await renderViolationDetail(admin, message, Number(parts[3]) || 0, parseModerationContext(parts.slice(4)));
      return true;
    }
    if (section === 'act') {
      const action = parts[3];
      if (MODERATION_ACTIONS.includes(action as ModerationAction)) {
        await applyModerationAction(
          admin,
          message,
          telegramId,
          action as ModerationAction,
          Number(parts[4]) || 0,
          parseModerationContext(parts.slice(5)),
        );
      }
      return true;
    }

    await renderModerationMenu(admin, telegramId, editDeliver(message));
    return true;
  } catch (error) {
    if (!isModerationColumnError(error)) throw error;
    await renderModerationMigrationMessage(message);
    return true;
  }
}
