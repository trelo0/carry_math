import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type AdminPayload,
  type InlineButton,
  type InlineKeyboard,
  type ReplyKeyboard,
  clearStateIfAvailable,
  editAdminMessage,
  getState,
  isConversationStateTableError,
  migrationText,
  saveState,
  sendAdminMessage,
} from '../admin/core';
import {
  getGroupHomeworkForGroup,
  getHomeworkSubmission,
  getIndividualHomeworkByStatus,
  getMockGroup,
  getMockGroupHomeworkSummaries,
  getMockGroupMember,
  getMockGroups,
  getMockIndividualStudents,
  getMockStudent,
  type HomeworkSubmission,
  type MockGroup,
  type MockGroupMember,
  type MockStudent,
} from './mock-data';

// ---------------------------------------------------------------------------
// Интерфейс преподавателя (role = teacher) — этап проверки UX на MOCK-данных.
//
// Архитектура та же, что у админки:
// • Reply Keyboard — постоянное главное меню под полем ввода;
// • Inline Keyboard — экраны внутри разделов, навигация через editMessageText
//   (текущий блок обновляется локально, чат не заспамливается);
// • новое сообщение — результаты действий (ответ на введённый текст,
//   тестовые результаты проверок ДЗ), чтобы ответ был под сообщением
//   преподавателя.
//
// Все данные — mock-data.ts: ничего не пишется в Supabase, сообщения
// «ученикам» не доставляются, реальные Telegram ID не используются.
// ---------------------------------------------------------------------------

export const TEACHER_MENU_LABELS = {
  individual: '👤 МОИ ИНДИВИДУАЛЬНЫЕ',
  groups: '👥 МОИ МИНИ-ГРУППЫ',
  homework: '📝 ДОМАШНИЕ ЗАДАНИЯ',
  cabinet: '👤 ЛИЧНЫЙ КАБИНЕТ',
} as const;

export const TEACHER_MENU_LABEL_SET = new Set<string>(Object.values(TEACHER_MENU_LABELS));

const TEACHER_HOME_TEXT =
  '👨‍🏫 Кабинет преподавателя District\n\n' +
  'Разделы — на кнопках меню под полем ввода. Сейчас интерфейс работает на тестовых данных.';

const TEACHER_CABINET_TEXT =
  '🌐 Личный кабинет\n\nСсылка на личный кабинет будет подключена после готовности сайта.';

const TEACHER_UNKNOWN_TEXT =
  'Я не понял это сообщение.\n\nРазделы кабинета — на кнопках меню под полем ввода.';

// Шаг диалога «сообщение ученику»: в payload хранится mock-id ученика.
const TEACHER_MESSAGE_STEP = 'teacher:message';

const STUDENT_STATUS_LABEL = 'активный';
const GROUP_STATUS_LABEL = 'активная';

// ---------------------------------------------------------------------------
// Главное меню (Reply Keyboard)
// ---------------------------------------------------------------------------

export function teacherReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: TEACHER_MENU_LABELS.individual }],
      [{ text: TEACHER_MENU_LABELS.groups }],
      [{ text: TEACHER_MENU_LABELS.homework }],
      [{ text: TEACHER_MENU_LABELS.cabinet }],
    ],
    resize_keyboard: true,
  };
}

// /start для роли teacher: приветствие + постоянное меню.
export async function sendTeacherStart(chatId: number, testFooter = ''): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: TEACHER_HOME_TEXT + testFooter,
    reply_markup: teacherReplyKeyboard(),
  });
}

// ---------------------------------------------------------------------------
// Построители экранов (чистые функции — используются и в тестах).
// Колбэки: префикс t:, лимит Telegram 64 байта соблюдается.
// ---------------------------------------------------------------------------

function backButton(text: string, callback: string): InlineButton {
  return { text, callback_data: callback };
}

function notFoundKeyboard(backText: string, backCallback: string): InlineKeyboard {
  return { inline_keyboard: [[backButton(`⬅️ ${backText}`, backCallback)]] };
}

export function renderIndividualList(): { text: string; keyboard: InlineKeyboard } {
  const students = getMockIndividualStudents();
  const text = `👤 МОИ ИНДИВИДУАЛЬНЫЕ\n\n${students.map((student) => student.name).join('\n')}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...students.map((student): InlineButton[] => [
        { text: student.name, callback_data: `t:st:${student.id}` },
      ]),
      [backButton('⬅️ Назад', 't:menu')],
    ],
  };
  return { text, keyboard };
}

export function renderStudentCard(student: MockStudent): { text: string; keyboard: InlineKeyboard } {
  const text =
    `👤 ${student.name}\n\n` +
    'Формат: индивидуальные занятия\n' +
    `Статус: ${STUDENT_STATUS_LABEL}\n` +
    `Домашних заданий: ${student.homeworkCount}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [{ text: '📝 Домашние задания', callback_data: `t:shw:${student.id}` }],
      [{ text: '💬 Написать ученику', callback_data: `t:msg:${student.id}` }],
      [backButton('⬅️ Назад', 't:list:i')],
    ],
  };
  return { text, keyboard };
}

export function renderGroupList(): { text: string; keyboard: InlineKeyboard } {
  const groups = getMockGroups();
  const text = `👥 МОИ МИНИ-ГРУППЫ\n\n${groups.map((group) => group.title).join('\n')}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...groups.map((group): InlineButton[] => [{ text: group.title, callback_data: `t:gr:${group.id}` }]),
      [backButton('⬅️ Назад', 't:menu')],
    ],
  };
  return { text, keyboard };
}

export function renderGroupCard(group: MockGroup): { text: string; keyboard: InlineKeyboard } {
  const text =
    `👥 ${group.title}\n\n` +
    `Ученики: ${group.members.length}\n` +
    `Статус: ${GROUP_STATUS_LABEL}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [{ text: '👤 Ученики', callback_data: `t:gm:${group.id}` }],
      [{ text: '📝 Домашние задания', callback_data: `t:ghw:${group.id}` }],
      [backButton('⬅️ Назад', 't:list:g')],
    ],
  };
  return { text, keyboard };
}

export function renderGroupMembers(group: MockGroup): { text: string; keyboard: InlineKeyboard } {
  const list = group.members.map((member, index) => `${index + 1}. ${member.name}`).join('\n');
  const text = `👥 Ученики группы ${group.title}\n\n${list}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...group.members.map((member): InlineButton[] => [
        { text: member.name, callback_data: `t:gs:${group.id}:${member.id}` },
      ]),
      [backButton('⬅️ Назад', `t:gr:${group.id}`)],
    ],
  };
  return { text, keyboard };
}

// Карточка ученика мини-группы: тот же безопасный формат, без контактов.
export function renderGroupMemberCard(
  group: MockGroup,
  member: MockGroupMember,
): { text: string; keyboard: InlineKeyboard } {
  const text =
    `👤 ${member.name}\n\n` +
    'Формат: мини-группа\n' +
    `Группа: ${group.title}\n` +
    `Статус: ${STUDENT_STATUS_LABEL}`;
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [{ text: '📝 Домашние задания', callback_data: `t:ghw:${group.id}` }],
      [{ text: '💬 Написать ученику', callback_data: `t:gmsg:${group.id}:${member.id}` }],
      [backButton('⬅️ Назад', `t:gm:${group.id}`)],
    ],
  };
  return { text, keyboard };
}

export function renderHomeworkSelect(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '📝 ДОМАШНИЕ ЗАДАНИЯ',
    keyboard: {
      inline_keyboard: [
        [{ text: '👤 ИНДИВИДУАЛЬНЫЕ', callback_data: 't:hw:i' }],
        [{ text: '👥 МИНИ-ГРУППЫ', callback_data: 't:hw:g' }],
        [backButton('⬅️ Назад', 't:menu')],
      ],
    },
  };
}

export function renderIndividualHomework(): { text: string; keyboard: InlineKeyboard } {
  const pending = getIndividualHomeworkByStatus('pending');
  const checked = getIndividualHomeworkByStatus('checked');
  const parts = [
    '📝 ИНДИВИДУАЛЬНЫЕ',
    '',
    `🔴 Требуют проверки — ${pending.length}`,
    '',
    ...pending.map((item) => `${item.studentName} — ДЗ №${item.number}`),
    '',
    `🟢 Проверены — ${checked.length}`,
    '',
    ...checked.map((item) => `${item.studentName} — ДЗ №${item.number}`),
  ];
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...[...pending, ...checked].map((item): InlineButton[] => [
        { text: `${item.studentName} — ДЗ №${item.number}`, callback_data: `t:hwv:${item.id}` },
      ]),
      [backButton('⬅️ Назад', 't:hw')],
    ],
  };
  return { text: parts.join('\n'), keyboard };
}

export function renderGroupHomeworkList(): { text: string; keyboard: InlineKeyboard } {
  const summaries = getMockGroupHomeworkSummaries();
  const parts = ['📝 ДОМАШНИЕ ЗАДАНИЯ — МИНИ-ГРУППЫ', '', '🔴 Требуют проверки'];
  for (const summary of summaries) {
    parts.push('', summary.groupTitle, `${summary.pendingCount} ${pluralWorks(summary.pendingCount)}`);
  }
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...summaries.map((summary): InlineButton[] => [
        { text: summary.groupTitle, callback_data: `t:ghw:${summary.groupId}` },
      ]),
      [backButton('⬅️ Назад', 't:hw')],
    ],
  };
  return { text: parts.join('\n'), keyboard };
}

export function renderGroupHomework(group: MockGroup): { text: string; keyboard: InlineKeyboard } {
  const works = getGroupHomeworkForGroup(group.id);
  const pending = works.filter((item) => item.status === 'pending');
  const parts = [
    `👥 ${group.title}`,
    '',
    `🔴 Требуют проверки: ${pending.length}`,
    '',
    ...pending.map((item) => `${item.studentName} — ДЗ №${item.number}`),
  ];
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...pending.map((item): InlineButton[] => [
        { text: `${item.studentName} — ДЗ №${item.number}`, callback_data: `t:hwv:${item.id}` },
      ]),
      [backButton('⬅️ Назад', 't:hw:g')],
    ],
  };
  return { text: parts.join('\n'), keyboard };
}

export function renderHomeworkCard(submission: HomeworkSubmission): { text: string; keyboard: InlineKeyboard } {
  const statusLabel = submission.status === 'pending' ? '🔴 Требует проверки' : '🟢 Проверено';
  const formatLabel = submission.format === 'individual' ? 'индивидуальные занятия' : 'мини-группа';
  const groupLine = submission.groupTitle ? `\nГруппа: ${submission.groupTitle}` : '';
  const text =
    '📝 ДОМАШНЕЕ ЗАДАНИЕ\n\n' +
    `Ученик: ${submission.studentName}\n` +
    `Формат: ${formatLabel}${groupLine}\n` +
    `Задание: №${submission.number}\n` +
    `Статус: ${statusLabel}\n\n` +
    '📎 Файл ученика';
  const backCallback = submission.format === 'individual' ? 't:hw:i' : 't:hw:g';
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [{ text: '👀 Посмотреть', callback_data: `t:hwa:view:${submission.id}` }],
      [{ text: '✅ Проверено', callback_data: `t:hwa:check:${submission.id}` }],
      [{ text: '💬 Написать комментарий', callback_data: `t:hwa:comment:${submission.id}` }],
      [{ text: '❌ Вернуть на доработку', callback_data: `t:hwa:return:${submission.id}` }],
      [backButton('⬅️ Назад', backCallback)],
    ],
  };
  return { text, keyboard };
}

export function renderCabinet(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: TEACHER_CABINET_TEXT,
    keyboard: { inline_keyboard: [[backButton('⬅️ Назад', 't:menu')]] },
  };
}

function pluralWorks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'работа';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'работы';
  return 'работ';
}

// Тестовый результат действия с ДЗ: новое сообщение под сообщением
// преподавателя + возврат к списку работ.
const HOMEWORK_ACTION_LABELS: Record<string, string> = {
  view: '👀 Просмотр работы',
  check: '✅ Отметка «Проверено»',
  comment: '💬 Комментарий к работе',
  return: '❌ Возврат на доработку',
};

function renderHomeworkActionResult(action: string, submission: HomeworkSubmission): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const backCallback = submission.format === 'individual' ? 't:hw:i' : 't:hw:g';
  return {
    text:
      `${HOMEWORK_ACTION_LABELS[action] ?? 'Действие с ДЗ'}\n\n` +
      'Это тестовая функция проверки ДЗ.\n' +
      `Работа: ${submission.studentName} — ДЗ №${submission.number}`,
    keyboard: { inline_keyboard: [[backButton('⬅️ К списку работ', backCallback)]] },
  };
}

// ---------------------------------------------------------------------------
// Эффективная роль: тестер с маской /as teacher видит кабинет преподавателя.
// ---------------------------------------------------------------------------

async function effectiveTeacherRole(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'guest';
  const role = String(data.role);
  const viewRole = data.view_role as string | null;
  if (role === 'test' && viewRole && viewRole !== 'test') return viewRole;
  return role;
}

async function editTeacherScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard): Promise<void> {
  await editAdminMessage(message, text, keyboard);
}

// ---------------------------------------------------------------------------
// Текст Reply Keyboard: разделы главного меню + ввод сообщения ученику.
// Возвращает false для чужого текста (дальше — контроль переписки).
// ---------------------------------------------------------------------------

export async function handleTeacherMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const role = await effectiveTeacherRole(admin, telegramId);
  if (role !== 'teacher') return false;

  // Диалог «Написать ученику»: состояние шага хранится в
  // bot_conversation_states (общий механизм состояний бота).
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  // Шаг teacher:message не входит в union админских шагов: состояние
  // читается тем же механизмом, тип сравнивается как строка.
  const stateStep = state?.step as string | undefined;
  if (state && stateStep === TEACHER_MESSAGE_STEP) {
    await clearStateIfAvailable(admin, telegramId);
    const payload = state.payload as AdminPayload & { studentId?: string };
    const student = payload.studentId ? getMockStudent(payload.studentId) : undefined;
    const member = !student && payload.studentId ? findGroupMemberByStateId(payload.studentId) : undefined;
    const recipient = student?.name ?? member?.name ?? 'ученик';
    // MOCK: сообщение никуда не доставляется — только тестовый отчёт.
    await sendAdminMessage(
      chatId,
      '✅ Тестовое сообщение отправлено.\n\n' +
        `Получатель:\n${recipient}\n\n` +
        `Сообщение:\n«${text}»\n\n` +
        'В реальной версии сообщение будет доставлено ученику через Telegram-бота.',
      {
        inline_keyboard: [
          [backButton('⬅️ Назад', student ? `t:st:${student.id}` : `t:gs:${member?.groupId ?? 'g1'}:${member?.memberId ?? 'm1'}`)],
        ],
      },
    );
    return true;
  }

  if (!TEACHER_MENU_LABEL_SET.has(text)) {
    await sendAdminMessage(chatId, TEACHER_UNKNOWN_TEXT);
    return true;
  }

  if (text === TEACHER_MENU_LABELS.cabinet) {
    const cabinet = renderCabinet();
    await sendAdminMessage(chatId, cabinet.text, cabinet.keyboard);
    return true;
  }

  const screen =
    text === TEACHER_MENU_LABELS.individual
      ? renderIndividualList()
      : text === TEACHER_MENU_LABELS.groups
        ? renderGroupList()
        : renderHomeworkSelect();
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
  return true;
}

// Состояние хранит составной id «groupId:memberId» для учеников групп.
function findGroupMemberByStateId(stateId: string): (MockGroupMember & { groupId: string; memberId: string }) | undefined {
  const [groupId, memberId] = stateId.split(':');
  if (!groupId || !memberId) return undefined;
  const member = getMockGroupMember(groupId, memberId);
  return member ? { ...member, groupId, memberId } : undefined;
}

// ---------------------------------------------------------------------------
// Inline-навигация: все колбэки t:*. Возвращает false для чужих префиксов
// и для не-преподавателей (кнопки улетят дальше по цепочке вебхука).
// ---------------------------------------------------------------------------

export async function handleTeacherCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('t:')) return false;
  const role = await effectiveTeacherRole(admin, telegramId);
  if (role !== 'teacher') return false;

  const message: AdminMessage = { chatId, messageId };
  const parts = data.split(':');
  const handled = await routeTeacherCallback(admin, message, telegramId, parts);
  if (!handled) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
  return true;
}

async function routeTeacherCallback(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  parts: string[],
): Promise<boolean> {
  const [, action, id, subId] = parts;

  switch (action) {
    // Главное меню: подсказка про постоянную Reply Keyboard.
    case 'menu': {
      await editTeacherScreen(message, TEACHER_HOME_TEXT, { inline_keyboard: [] });
      return true;
    }

    // Списки направлений.
    case 'list': {
      const screen = id === 'i' ? renderIndividualList() : renderGroupList();
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Карточка индивидуального ученика.
    case 'st': {
      const student = id ? getMockStudent(id) : undefined;
      if (!student) {
        await editTeacherScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 't:list:i'));
        return true;
      }
      const screen = renderStudentCard(student);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Список групп / карточка группы.
    case 'gr': {
      const group = id ? getMockGroup(id) : undefined;
      if (!group) {
        await editTeacherScreen(message, 'Группа не найдена.', notFoundKeyboard('Назад', 't:list:g'));
        return true;
      }
      const screen = renderGroupCard(group);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Ученики группы.
    case 'gm': {
      const group = id ? getMockGroup(id) : undefined;
      if (!group) {
        await editTeacherScreen(message, 'Группа не найдена.', notFoundKeyboard('Назад', 't:list:g'));
        return true;
      }
      const screen = renderGroupMembers(group);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Карточка ученика мини-группы.
    case 'gs': {
      const group = id ? getMockGroup(id) : undefined;
      const member = group && subId ? getMockGroupMember(group.id, subId) : undefined;
      if (!group || !member) {
        await editTeacherScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 't:list:g'));
        return true;
      }
      const screen = renderGroupMemberCard(group, member);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // ДЗ индивидуального ученика (работы его формата).
    case 'shw': {
      const screen = renderIndividualHomework();
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Выбор раздела ДЗ.
    case 'hw': {
      if (id === 'i') {
        const screen = renderIndividualHomework();
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'g') {
        const screen = renderGroupHomeworkList();
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const screen = renderHomeworkSelect();
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // ДЗ мини-группы.
    case 'ghw': {
      const group = id ? getMockGroup(id) : undefined;
      if (!group) {
        await editTeacherScreen(message, 'Группа не найдена.', notFoundKeyboard('Назад', 't:hw:g'));
        return true;
      }
      const screen = renderGroupHomework(group);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Карточка конкретной работы.
    case 'hwv': {
      const submission = id ? getHomeworkSubmission(id) : undefined;
      if (!submission) {
        await editTeacherScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 't:hw'));
        return true;
      }
      const screen = renderHomeworkCard(submission);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Тестовые действия с ДЗ: результат — новым сообщением.
    case 'hwa': {
      const submission = subId ? getHomeworkSubmission(subId) : undefined;
      if (!submission) {
        await editTeacherScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 't:hw'));
        return true;
      }
      const result = renderHomeworkActionResult(id ?? '', submission);
      await sendAdminMessage(message.chatId, result.text, result.keyboard);
      return true;
    }

    // «Написать ученику»: индивидуал и ученик группы.
    case 'msg':
    case 'gmsg': {
      const student = action === 'msg' && id ? getMockStudent(id) : undefined;
      const group = action === 'gmsg' && id ? getMockGroup(id) : undefined;
      const member = group && subId ? getMockGroupMember(group.id, subId) : undefined;
      if (!student && !(group && member)) {
        await editTeacherScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 't:menu'));
        return true;
      }
      const recipient = student?.name ?? member?.name ?? '';
      const stateId = student ? student.id : `${group?.id}:${member?.id}`;
      const promptText = `💬 Написать ${dativeName(recipient)}\n\nВведите сообщение:`;
      const promptKeyboard: InlineKeyboard = {
        inline_keyboard: [[backButton('⬅️ Отмена', student ? `t:msgc:i:${student?.id}` : `t:msgc:g:${group?.id}:${member?.id}`)]],
      };
      try {
        const promptId = await sendAdminMessage(message.chatId, promptText, promptKeyboard);
        await saveState(
          admin,
          telegramId,
          { chatId: message.chatId, messageId: promptId ?? 0 },
          TEACHER_MESSAGE_STEP as never,
          { studentId: stateId } as never,
        );
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
        await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
      }
      return true;
    }

    // Отмена ввода сообщения: подсказка + возврат к карточке.
    case 'msgc': {
      await clearStateIfAvailable(admin, telegramId);
      const backCallback = id === 'i' ? `t:st:${subId}` : `t:gs:${subId}:${parts[3] ?? ''}`;
      await editTeacherScreen(
        message,
        '✖️ Отправка отменена.',
        notFoundKeyboard('К карточке ученика', backCallback),
      );
      return true;
    }

    case 'cab': {
      const screen = renderCabinet();
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    default:
      return false;
  }
}

// «Написать Ивану Петрову» — простое склонение для MOCK-имён из списка.
function dativeName(name: string): string {
  const [firstName, lastName] = name.split(' ');
  const first =
    firstName?.endsWith('а') ? `${firstName.slice(0, -1)}е`
    : firstName?.endsWith('й') ? `${firstName.slice(0, -2)}ю`
    : firstName
      ? `${firstName}у`
      : name;
  const last =
    lastName?.endsWith('а') ? `${lastName.slice(0, -1)}ой`
    : lastName?.endsWith('ва') ? `${lastName.slice(0, -2)}ой`
    : lastName
      ? `${lastName}у`
      : '';
  return last ? `${first} ${last}` : first;
}
