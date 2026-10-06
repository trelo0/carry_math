import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type BotRole,
  type MemberRow,
  countLeadsByPhone,
  getMember,
  getModerationInfo,
  isAdminEnv,
  isBotRole,
  listMembersInRoles,
  roleLabel,
  searchMembers,
  setRole,
  addMemberExtraRole,
  removeMemberExtraRole,
  combineMemberRoles,
  normalizeMemberRole,
} from '@/lib/bot/roles';
import {
  EXTRA_ASSIGNABLE,
  formatExtraRolesList,
  getMemberWithExtras,
  memberRolesSummary,
} from './staff-roster';
import {
  type UserViolationStats,
  getUserViolationStats,
  isModerationColumnError,
  isViolationTableError,
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
  showAdminHome,
} from './core';
import { handleStatsAction } from './stats';
import { loadUserEducationSummary } from './education-ops';
import { logAdminAction } from './action-log';
import { personHubNavRows } from './person-hub';

// ---------------------------------------------------------------------------
// Панель администратора: пользователи и роли
// ---------------------------------------------------------------------------

// Точные callback'и панели. admin:user:* и admin:cat:* матчатся по префиксу.
const PANEL_CALLBACKS = [
  'admin:home',
  'admin:users',
  'admin:users:search',
  'admin:stats',
];

export function isPanelAction(data: string): boolean {
  return (
    PANEL_CALLBACKS.includes(data) ||
    data.startsWith('admin:user:') ||
    data.startsWith('admin:cat:') ||
    data.startsWith('admin:stats:')
  );
}

// Роли, которые админ назначает через панель. test — только владелец бота.
const ASSIGNABLE_ROLES: BotRole[] = ['guest', 'student', 'curator', 'teacher', 'admin'];

// Размер страницы списка пользователей задаёт USERS_PER_PAGE в core.ts.

// Категории пользователей. «Платные» и «Ученики» пока определяются ролью
// student (в bot_members она означает «купил курс»): отдельных таблиц
// оплат и доступов в проекте нет. «Кураторы» включают легаси-роль mentor.
type UserCategoryId = 'all' | 'guest' | 'paid' | 'student' | 'curator' | 'teacher' | 'admin';

type UserCategory = {
  id: UserCategoryId;
  buttonLabel: string;
  title: string;
  roles: string[];
};

const USER_CATEGORIES: UserCategory[] = [
  { id: 'all', buttonLabel: '👥 Все пользователи', title: 'Все пользователи', roles: ['guest', 'student', 'curator', 'teacher', 'mentor', 'admin', 'test'] },
  { id: 'guest', buttonLabel: '❄️ Гости', title: 'Гости', roles: ['guest'] },
  { id: 'paid', buttonLabel: '💳 Платные пользователи', title: 'Платные пользователи', roles: ['student'] },
  { id: 'student', buttonLabel: '🎓 Ученики', title: 'Ученики', roles: ['student'] },
  { id: 'curator', buttonLabel: '🟡 Кураторы', title: 'Кураторы / менторы', roles: ['curator', 'mentor'] },
  { id: 'teacher', buttonLabel: '🟠 Преподаватели', title: 'Преподаватели', roles: ['teacher'] },
  { id: 'admin', buttonLabel: '🔐 Администраторы', title: 'Администраторы', roles: ['admin'] },
];

function findCategory(id: string): UserCategory | undefined {
  return USER_CATEGORIES.find((category) => category.id === id);
}

export function memberDisplayName(member: MemberRow): string {
  return member.full_name?.trim() || `ID ${member.telegram_id}`;
}

// «✈️ Telegram подключён» — у участника сохранён chat_id, то есть бот
// может доставлять ему сообщения.
export function memberCard(member: MemberRow): string {
  const lines = [`👤 ${memberDisplayName(member)}`];
  if (member.phone) lines.push(`📱 ${member.phone}`);
  lines.push(`✈️ Telegram: ${member.chat_id ? 'подключён' : 'не подключён'}`);
  lines.push(`🎭 Роль: ${roleLabel(member.role)}`);
  return lines.join('\n');
}

// Меню раздела: из Reply Keyboard приходит новым сообщением,
// из inline-навигации — редактирует текущий блок.
export async function renderUsersMenu(admin: SupabaseClient, telegramId: number, deliver: Deliver): Promise<void> {
  // Вне активного поиска текст админа не должен попадать в поиск.
  await clearStateIfAvailable(admin, telegramId);
  const keyboard: InlineButton[][] = [
    [{ text: '🔎 Поиск пользователя', callback_data: 'admin:users:search' }],
    ...USER_CATEGORIES.map((category) => [
      { text: category.buttonLabel, callback_data: `admin:cat:${category.id}:0` },
    ]),
    [homeButton()],
  ];
  await deliver(
    '👥 Пользователи\n\nВыбери категорию или найди пользователя по имени и телефону.',
    { inline_keyboard: keyboard },
  );
}

async function renderUserSearchPrompt(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  searchBack = 'admin:users',
): Promise<void> {
  await saveState(admin, telegramId, message, 'users:search', { searchBack });
  await editAdminMessage(
    message,
    '🔎 Поиск человека\n\nИмя, фамилия, телефон, Telegram ID.\nМинимум 2 символа.',
    {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: searchBack }],
        [homeButton()],
      ],
    },
  );
}

function searchResultCard(admin: SupabaseClient, member: MemberRow): Promise<string> {
  return (async () => {
    const withExtra = await getMemberWithExtras(admin, member.telegram_id);
    const roles = memberRolesSummary(member.role, withExtra?.extra_roles ?? []);
    const isStudent = member.role === 'student';
    const icon = isStudent ? '👨‍🎓' : '👨‍💼';
    const lines = [`${icon} ${memberDisplayName(member)}`, roles];
    if (member.phone) lines.push(`📱 ${member.phone}`);
    return lines.join('\n');
  })();
}

// Результаты поиска — ответ на текстовый ввод: всегда новое сообщение,
// чтобы результат появлялся сразу под запросом админа.
export async function renderUsersSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const chatId = state.chat_id;
  const back = state.payload?.searchBack ?? 'admin:users';
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    await sendAdminMessage(
      chatId,
      '🔎 Поиск\n\nЗапрос слишком короткий — минимум 2 символа.',
      {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: back }], [homeButton()]],
      },
    );
    return;
  }

  const members = await searchMembers(admin, trimmed);
  if (members.length === 0) {
    await sendAdminMessage(
      chatId,
      `🔎 Никого не нашли по «${trimmed}».\n\nОтправь другой запрос сообщением.`,
      {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: back }], [homeButton()]],
      },
    );
    return;
  }

  const cards = await Promise.all(members.map((m) => searchResultCard(admin, m)));
  const text = ['🔎 Результаты поиска', '', ...cards.flatMap((c) => [c, ''])].join('\n');

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 40)}`,
      callback_data: `admin:user:${member.telegram_id}::people`,
    },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: back }], [homeButton()]);

  await sendAdminMessage(chatId, text, { inline_keyboard: keyboard });
}

// Страница списка пользователей категории с пагинацией.
async function renderUserList(
  admin: SupabaseClient,
  message: AdminMessage,
  category: UserCategory,
  page: number,
): Promise<void> {
  const { members, total } = await listMembersInRoles(admin, category.roles, page, USERS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 40)}`,
      callback_data: `admin:user:${member.telegram_id}::${category.id}:${safePage}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️ Назад' : '·',
        callback_data: safePage > 0 ? `admin:cat:${category.id}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️ Далее' : '·',
        callback_data: safePage < pageCount - 1 ? `admin:cat:${category.id}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ К пользователям', callback_data: 'admin:users' }], [homeButton()]);

  const text =
    total === 0
      ? `${category.title}: пока никого нет.`
      : [
          `${category.title}: всего ${total}`,
          '',
          ...members.map((member, index) => `${safePage * USERS_PER_PAGE + index + 1}. ${memberCard(member)}`),
        ].join('\n\n');

  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

async function renderExtraRolesMenu(message: AdminMessage, member: MemberRow, extra: string[]): Promise<void> {
  const keyboard: InlineButton[][] = [
    [{ text: '➕ Добавить роль', callback_data: `admin:user:${member.telegram_id}:xpick:add::` }],
  ];
  for (const raw of extra) {
    const r = normalizeMemberRole(raw);
    keyboard.push([
      {
        text: `➖ Снять «${roleLabel(r)}»`,
        callback_data: `admin:user:${member.telegram_id}:xrem:${r}::`,
      },
    ]);
  }
  keyboard.push([{ text: '↩️ К профилю', callback_data: `admin:user:${member.telegram_id}::` }]);
  await editAdminMessage(
    message,
    `➕ Дополнительные роли\n\n${memberDisplayName(member)}\n\nСейчас: ${formatExtraRolesList(extra)}`,
    { inline_keyboard: keyboard },
  );
}

async function renderExtraRolePick(message: AdminMessage, member: MemberRow, extra: string[]): Promise<void> {
  const combined = combineMemberRoles(member.role, extra);
  const keyboard: InlineButton[][] = [];
  for (const role of EXTRA_ASSIGNABLE) {
    if (memberHasExtra(combined, role)) continue;
    keyboard.push([
      {
        text: roleLabel(role),
        callback_data: `admin:user:${member.telegram_id}:xadd:${role}::`,
      },
    ]);
  }
  if (keyboard.length === 0) {
    keyboard.push([{ text: 'Все роли уже назначены', callback_data: 'noop' }]);
  }
  keyboard.push([{ text: '↩️ Назад', callback_data: `admin:user:${member.telegram_id}:extra::` }]);
  await editAdminMessage(message, 'Выбери дополнительную роль:', { inline_keyboard: keyboard });
}

function memberHasExtra(combined: BotRole[], role: BotRole): boolean {
  return combined.some((r) => normalizeMemberRole(r) === normalizeMemberRole(role));
}

async function renderUserProfile(
  admin: SupabaseClient,
  message: AdminMessage,
  member: MemberRow,
  back: InlineButton = { text: '⬅️ Назад', callback_data: 'admin:users' },
): Promise<void> {
  const withExtra = await getMemberWithExtras(admin, member.telegram_id);
  const extra = withExtra?.extra_roles ?? [];
  let leads = 0;
  try {
    if (member.phone) leads = await countLeadsByPhone(admin, member.phone);
  } catch (error) {
    // Заявки — дополнительная информация; без них карточка остаётся работоспособной.
    console.error('Не удалось получить заявки пользователя:', error);
  }

  // Данные контроля переписки: до применения bot_moderation.sql колонок
  // ещё нет — тогда блок модерации просто не показывается.
  let moderationStatus: string | null = null;
  try {
    const info = await getModerationInfo(admin, member.telegram_id);
    moderationStatus = info?.moderationStatus ?? null;
  } catch (error) {
    if (!isModerationColumnError(error)) console.error('Не удалось получить статус модерации:', error);
  }

  let stats: UserViolationStats | null = null;
  try {
    stats = await getUserViolationStats(admin, member.telegram_id);
  } catch (error) {
    if (!isViolationTableError(error)) console.error('Не удалось получить счётчики нарушений:', error);
  }

  let eduSummary = {
    accessLines: ['📚 Доступы: нет данных'],
    packageLines: ['📦 Пакеты: нет данных'],
    groupLine: '👥 Группа: нет данных',
    mentorLines: ['🧑‍🏫 Наставник: нет данных'],
  };
  try {
    eduSummary = await loadUserEducationSummary(admin, member.telegram_id);
  } catch (error) {
    console.error('Не удалось загрузить учебные данные:', error);
  }

  const lines = [
    `👤 ${memberDisplayName(member)}`,
    member.phone ? `📱 Телефон: ${member.phone}` : '📱 Телефон: не указан',
    `✈️ Telegram: ${member.chat_id ? 'подключён' : 'не подключён'}`,
    `🎭 Роли: ${memberRolesSummary(member.role, extra)}`,
    ...eduSummary.accessLines,
    ...eduSummary.packageLines,
    eduSummary.groupLine,
    ...eduSummary.mentorLines,
  ];
  if (leads > 0) lines.push(`📝 Заявок с сайта: ${leads}`);
  if (moderationStatus === 'blocked') lines.push('🔒 Статус доступа: заблокирован');
  if (moderationStatus === 'restricted') lines.push('🚫 Статус доступа: ограничен');
  if (stats && stats.total > 0) {
    lines.push(
      '',
      '🚨 Контроль переписки:',
      `🚨 Нарушений: ${stats.total}`,
      `⚠️ Предупреждений: ${stats.warnings}`,
      `🚫 Ограничений: ${stats.restrictions}`,
      `🔒 Блокировок: ${stats.blocks}`,
    );
  }

  const isStudent = member.role === 'student';
  const keyboard: InlineButton[][] = [...personHubNavRows(member.telegram_id, isStudent)];
  keyboard.push([{ text: '📅 Назначить занятие', callback_data: `ae:sched:${member.telegram_id}` }]);
  if (isStudent) {
    keyboard.push(
      [{ text: '👤 Назначить наставника', callback_data: `ae:mentor:${member.telegram_id}` }],
      [{ text: '📦 Пакеты', callback_data: `apk:stu:${member.telegram_id}` }],
    );
  }
  keyboard.push(
    [{ text: '🎭 Основная роль', callback_data: `admin:user:${member.telegram_id}:role::` }],
    [{ text: '➕ Доп. роли', callback_data: `admin:user:${member.telegram_id}:extra::` }],
  );
  if (stats) {
    keyboard.push([{ text: '📋 История нарушений', callback_data: `admin:mod:usr:${member.telegram_id}:0` }]);
  }
  if (moderationStatus === 'blocked') {
    keyboard.push([{ text: '🔓 Разблокировать', callback_data: `admin:mod:unblock:${member.telegram_id}` }]);
  }
  if (moderationStatus === 'restricted') {
    keyboard.push([{ text: '🔓 Снять ограничение', callback_data: `admin:mod:unrestrict:${member.telegram_id}` }]);
  }
  keyboard.push([back], [homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderRoleChoices(
  message: AdminMessage,
  member: MemberRow,
  callerId: number,
  back: InlineButton,
): Promise<void> {
  const roles: BotRole[] = isAdminEnv(callerId) ? [...ASSIGNABLE_ROLES, 'test'] : ASSIGNABLE_ROLES;
  const keyboard: InlineButton[][] = roles.map((role) => [
    {
      text: `${member.role === role ? '✅ ' : ''}${roleLabel(role)}`,
      callback_data: `admin:user:${member.telegram_id}:set:${role}::`,
    },
  ]);
  keyboard.push([{ text: '↩️ К профилю', callback_data: `admin:user:${member.telegram_id}::` }]);

  await editAdminMessage(
    message,
    `🎭 Выбери новую роль для «${memberDisplayName(member)}».\n\nТекущая роль: ${roleLabel(member.role)}.`,
    { inline_keyboard: keyboard },
  );
}

async function renderRoleConfirm(message: AdminMessage, member: MemberRow, role: BotRole): Promise<void> {
  await editAdminMessage(
    message,
    `Назначить роль «${roleLabel(role)}» пользователю ${memberDisplayName(member)}?`,
    {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: `admin:user:${member.telegram_id}:confirm:${role}::` }],
        [{ text: '↩️ Отмена', callback_data: `admin:user:${member.telegram_id}:role::` }],
      ],
    },
  );
}

async function applyRoleChange(
  admin: SupabaseClient,
  message: AdminMessage,
  member: MemberRow,
  role: BotRole,
  callerId: number,
): Promise<void> {
  if (role === 'test' && !isAdminEnv(callerId)) {
    await editAdminMessage(message, 'Роль test назначается только владельцу бота.', {
      inline_keyboard: [[{ text: '↩️ К профилю', callback_data: `admin:user:${member.telegram_id}::` }]],
    });
    return;
  }

  // setRole сам обновляет updated_at.
  const found = await setRole(admin, member.telegram_id, role);
  if (found) {
    await logAdminAction(admin, {
      actorTelegramId: callerId,
      action: 'user.role',
      entityType: 'bot_member',
      targetTelegramId: member.telegram_id,
      detail: { role },
    });
  }
  const text = found
    ? `✅ Роль «${roleLabel(role)}» установлена для ${memberDisplayName(member)}.`
    : 'Пользователь не найден — возможно, запись уже удалена.';
  await editAdminMessage(message, text, {
    inline_keyboard: [[{ text: '↩️ К профилю пользователя', callback_data: `admin:user:${member.telegram_id}::` }]],
  });
}

// Callback-кнопки панели: пользователи, категории, заглушки и возврат домой.
// Всегда возвращает true.
export async function handlePanelAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'admin:home') {
    await clearStateIfAvailable(admin, telegramId);
    const { renderAdminHomeDashboard } = await import('./home');
    await renderAdminHomeDashboard(admin, editDeliver(message), telegramId);
    return true;
  }

  if (data === 'admin:users') {
    await renderUsersMenu(admin, telegramId, editDeliver(message));
    return true;
  }

  if (data === 'admin:users:search') {
    try {
      await renderUserSearchPrompt(admin, telegramId, message);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      await editAdminMessage(message, migrationText('bot_conversation_states.sql'), homeOnlyKeyboard());
    }
    return true;
  }

  if (data === 'admin:stats' || data.startsWith('admin:stats:')) {
    return await handleStatsAction(admin, data, message);
  }

  // admin:cat:<категория>:<страница>
  if (data.startsWith('admin:cat:')) {
    const [, , categoryId, pageRaw] = data.split(':');
    const category = findCategory(categoryId);
    const page = Math.max(0, Number(pageRaw) || 0);
    if (category) await renderUserList(admin, message, category, page);
    else await renderUsersMenu(admin, telegramId, editDeliver(message));
    return true;
  }

  // admin:user:<telegram_id>:<действие>:<роль>:<категория>:<страница>
  // Части категории и страницы могут быть пустыми (поиск, профиль без контекста).
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    await showAdminHome(message);
    return true;
  }

  const member = await getMember(admin, targetId);
  if (!member) {
    await editAdminMessage(message, 'Пользователь не найден.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin:users' }], [homeButton()]],
    });
    return true;
  }

  const action = parts[3] || '';
  const role = parts[4];
  const ctx = action === '' ? (parts[4] ?? '') : (parts[5] ?? '');
  // admin:user:<id>::edu:ind:<page>
  const category = findCategory(ctx);
  const page = Math.max(0, Number(action === '' ? parts[6] : parts[6]) || 0);

  let back: InlineButton;
  if (ctx === 'people') {
    back = { text: '⬅️ Назад', callback_data: 'ah:people' };
  } else if (ctx === 'stu') {
    const filter = parts[5] ?? 'all';
    const stuPage = Math.max(0, Number(parts[6]) || 0);
    const adv = ['individual', 'course', 'group', 'low_pkg'].includes(filter);
    back = {
      text: '⬅️ Назад',
      callback_data: adv ? 'ah:stu:adv' : `ah:stu:f:${filter}:${stuPage}`,
    };
  } else if (ctx === 'staff') {
    const sf = parts[5] ?? 'all';
    const sp = Math.max(0, Number(parts[6]) || 0);
    back = { text: '⬅️ Назад', callback_data: `ah:staff:f:${sf}:${sp}` };
  } else if (ctx === 'edu') {
    const sub = parts[5] ?? 'ind';
    if (sub === 'ind') {
      const p = Math.max(0, Number(parts[6]) || 0);
      back = { text: '⬅️ Назад', callback_data: `ae:ind:${p}` };
    } else {
      back = { text: '⬅️ Назад', callback_data: 'ae:menu' };
    }
  } else if (category) {
    back = { text: '⬅️ Назад', callback_data: `admin:cat:${category.id}:${page}` };
  } else {
    back = { text: '⬅️ Назад', callback_data: 'admin:users' };
  }

  if (action === '') {
    await renderUserProfile(admin, message, member, back);
    return true;
  }

  if (action === 'role') {
    await renderRoleChoices(message, member, telegramId, back);
    return true;
  }

  if (action === 'extra') {
    const withExtra = await getMemberWithExtras(admin, targetId);
    await renderExtraRolesMenu(message, member, withExtra?.extra_roles ?? []);
    return true;
  }

  if (action === 'xpick' && parts[4] === 'add') {
    const withExtra = await getMemberWithExtras(admin, targetId);
    await renderExtraRolePick(message, member, withExtra?.extra_roles ?? []);
    return true;
  }

  if (action === 'xadd' && isBotRole(role)) {
    await addMemberExtraRole(admin, targetId, role);
    await logAdminAction(admin, {
      actorTelegramId: telegramId,
      action: 'user.extra_add',
      targetTelegramId: targetId,
      detail: { role },
    });
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (action === 'xrem' && isBotRole(role)) {
    await removeMemberExtraRole(admin, targetId, role);
    await logAdminAction(admin, {
      actorTelegramId: telegramId,
      action: 'user.extra_remove',
      targetTelegramId: targetId,
      detail: { role },
    });
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (!isBotRole(role)) {
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (action === 'set') {
    await renderRoleConfirm(message, member, role);
    return true;
  }

  if (action === 'confirm') {
    await applyRoleChange(admin, message, member, role, telegramId);
    return true;
  }

  await editAdminMessage(message, memberCard(member), {
    inline_keyboard: [
      [{ text: '🎭 Изменить роль', callback_data: `admin:user:${member.telegram_id}:role::` }],
      [back],
      [homeButton()],
    ],
  });
  return true;
}
