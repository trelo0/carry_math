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
} from '@/lib/bot/roles';
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
): Promise<void> {
  await saveState(admin, telegramId, message, 'users:search', {});
  await editAdminMessage(
    message,
    '🔎 Поиск пользователя\n\n' +
      'Отправь следующим сообщением имя, часть имени или телефон.\n\n' +
      'Например: «Иван», «29» или «37529».\n\n' +
      'Email в системе не хранится, поэтому поиск по нему недоступен.',
    {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
        [homeButton()],
      ],
    },
  );
}

// Результаты поиска — ответ на текстовый ввод: всегда новое сообщение,
// чтобы результат появлялся сразу под запросом админа.
export async function renderUsersSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const chatId = state.chat_id;
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    await sendAdminMessage(
      chatId,
      '🔎 Поиск пользователя\n\nЗапрос слишком короткий — введи минимум 2 символа.',
      {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
          [homeButton()],
        ],
      },
    );
    return;
  }

  const members = await searchMembers(admin, trimmed);
  if (members.length === 0) {
    await sendAdminMessage(
      chatId,
      `🔎 Никого не нашли по запросу «${trimmed}».\n\nПопробуй другое имя или телефон. Новый запрос — просто отправь его сообщением.`,
      {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
          [homeButton()],
        ],
      },
    );
    return;
  }

  const text = [
    `🔎 Результаты по запросу «${trimmed}»: ${members.length}`,
    '',
    ...members.map((member, index) => `${index + 1}. ${memberCard(member)}`),
    '',
    'Нажми на пользователя, чтобы открыть профиль. Новый запрос — просто отправь его сообщением.',
  ].join('\n\n');

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 40)}`,
      // Контекст не передаём: «Назад» из профиля после поиска ведёт в меню.
      callback_data: `admin:user:${member.telegram_id}::`,
    },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:users' }], [homeButton()]);

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

// Карточка пользователя. Поля без данных в системе помечены «нет данных»,
// чтобы не выдумывать сущности: таблиц оплат и занятий пока нет.
async function renderUserProfile(admin: SupabaseClient, message: AdminMessage, member: MemberRow): Promise<void> {
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

  const lines = [
    `👤 ${memberDisplayName(member)}`,
    member.phone ? `📱 Телефон: ${member.phone}` : '📱 Телефон: не указан',
    `✈️ Telegram: ${member.chat_id ? 'подключён' : 'не подключён'}`,
    `🎭 Роль: ${roleLabel(member.role)}`,
    `📚 Доступ к курсу: ${member.role === 'student' ? 'есть' : 'нет'}`,
    '👨‍🏫 Индивидуальные занятия: нет данных (таблицы занятий нет)',
    '👥 Групповые занятия: нет данных (таблицы занятий нет)',
    '💳 Оплата: нет данных (таблицы оплат нет)',
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

  const keyboard: InlineButton[][] = [
    [{ text: '🎭 Изменить роль', callback_data: `admin:user:${member.telegram_id}:role::` }],
  ];
  if (stats) {
    keyboard.push([{ text: '📋 История нарушений', callback_data: `admin:mod:usr:${member.telegram_id}:0` }]);
  }
  if (moderationStatus === 'blocked') {
    keyboard.push([{ text: '🔓 Разблокировать', callback_data: `admin:mod:unblock:${member.telegram_id}` }]);
  }
  if (moderationStatus === 'restricted') {
    keyboard.push([{ text: '🔓 Снять ограничение', callback_data: `admin:mod:unrestrict:${member.telegram_id}` }]);
  }
  keyboard.push([homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderRoleChoices(message: AdminMessage, member: MemberRow, callerId: number): Promise<void> {
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
    await showAdminHome(message);
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
  const category = findCategory(parts[5] ?? '');
  const page = Math.max(0, Number(parts[6]) || 0);
  // «Назад»: в список категории либо в меню пользователей после поиска.
  const back = category
    ? { text: '⬅️ Назад', callback_data: `admin:cat:${category.id}:${page}` }
    : { text: '⬅️ Назад', callback_data: 'admin:users' };

  if (action === '' ) {
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (action === 'role') {
    await renderRoleChoices(message, member, telegramId);
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
