import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCESS_PRODUCT_LABELS, ACCESS_PRODUCTS, grantAccess, isAccessProduct, revokeAccess } from '../accesses';
import { assignCurator, assignTeacher } from '../education/assignments';
import { notifyStudentLessonScheduled } from '../student-notifications';
import {
  addStudentToGroup,
  createGroup,
  getGroup,
  getGroupMembers,
  getStudentGroups,
  updateGroup,
  type Group,
} from '../education/groups';
import { LessonScheduleError, scheduleStudentLesson } from '../lesson-scheduling';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  clearState,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  getState,
  homeButton,
  homeOnlyKeyboard,
  isValidHttpUrl,
  saveState,
  sendAdminMessage,
  sendDeliver,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import { getMember } from '@/lib/bot/roles';

const GROUPS_PER_PAGE = 5;

function stateMessage(state: ConversationState, messageId?: number): AdminMessage {
  return { chatId: state.chat_id, messageId: messageId ?? state.message_id };
}

async function persistState(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  step: ConversationState['step'],
  payload: ConversationState['payload'],
  messageId?: number,
): Promise<void> {
  await saveState(admin, telegramId, stateMessage(state, messageId), step, payload);
}

export function isEducationAction(data: string): boolean {
  return data.startsWith('ae:');
}

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

function parseScheduleDateTime(input: string): string | null {
  const trimmed = input.trim();
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime()) && trimmed.includes('-')) return iso.toISOString();

  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (match) {
    const [, d, mo, y, h = '12', mi = '0'] = match;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

function parseTelegramId(input: string): number | null {
  const value = input.trim().replace(/\s/g, '');
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  return member ? memberDisplayName(member) : `ID ${telegramId}`;
}

function groupCard(group: Group, memberCount?: number): string {
  const lines = [`📚 ${group.title}`, `🆔 ${group.id}`];
  if (group.teacher_telegram_id) lines.push(`👨‍🏫 Препод: ${group.teacher_telegram_id}`);
  else lines.push('👨‍🏫 Препод: не назначен');
  if (group.curator_telegram_id) lines.push(`🟡 Куратор: ${group.curator_telegram_id}`);
  if (memberCount != null) lines.push(`👥 Участников: ${memberCount}`);
  return lines.join('\n');
}

export async function renderEducationMenu(deliver: Deliver): Promise<void> {
  await deliver('📚 Учёба\n\nГруппы и назначение ind/group занятий.', {
    inline_keyboard: [
      [{ text: '👥 Группы', callback_data: 'ae:groups:0' }],
      [{ text: '➕ Создать группу', callback_data: 'ae:g:new' }],
      [homeButton()],
    ],
  });
}

async function renderGroupsList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const from = page * GROUPS_PER_PAGE;
  const to = from + GROUPS_PER_PAGE - 1;
  const { data, error, count } = await admin
    .from('groups')
    .select('id, title, teacher_telegram_id, curator_telegram_id, status', { count: 'exact' })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const groups = (data ?? []) as Group[];
  const total = count ?? groups.length;
  const keyboard: InlineButton[][] = groups.map((group) => [
    {
      text: `${group.title}${group.teacher_telegram_id ? '' : ' · без препода'}`,
      callback_data: `ae:g:${group.id}`,
    },
  ]);

  if (page > 0) {
    keyboard.push([{ text: '◀️ Назад', callback_data: `ae:groups:${page - 1}` }]);
  }
  if (from + groups.length < total) {
    keyboard.push([{ text: '▶️ Далее', callback_data: `ae:groups:${page + 1}` }]);
  }
  keyboard.push(
    [{ text: '➕ Создать группу', callback_data: 'ae:g:new' }],
    [{ text: '↩️ Учёба', callback_data: 'ae:menu' }],
    [homeButton()],
  );

  const text =
    groups.length === 0
      ? '👥 Группы\n\nПока нет групп. Создай первую.'
      : ['👥 Группы', '', ...groups.map((g, i) => `${from + i + 1}. ${groupCard(g)}`)].join('\n\n');

  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

async function renderGroupDetail(admin: SupabaseClient, message: AdminMessage, groupId: number): Promise<void> {
  const group = await getGroup(admin, groupId);
  if (!group) {
    await editAdminMessage(message, 'Группа не найдена.', homeOnlyKeyboard());
    return;
  }

  const members = await getGroupMembers(admin, groupId);
  const memberLines =
    members.length === 0
      ? 'Участников пока нет.'
      : members.map((m, i) => `${i + 1}. ${m.full_name ?? `ID ${m.telegram_id}`}`).join('\n');

  const text = [groupCard(group, members.length), '', 'Состав:', memberLines].join('\n');
  const keyboard: InlineButton[][] = [
    [{ text: '➕ Добавить ученика', callback_data: `ae:g:${groupId}:add` }],
    [{ text: '👨‍🏫 Назначить препода', callback_data: `ae:g:${groupId}:teacher` }],
    [{ text: '↩️ К списку', callback_data: 'ae:groups:0' }],
    [homeButton()],
  ];
  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

async function startCreateGroup(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
  const messageId = await sendAdminMessage(
    message.chatId,
    '➕ Создание группы\n\nВведи название группы:',
    homeOnlyKeyboard(),
  );
  if (!messageId) return;
  await saveState(admin, telegramId, { chatId: message.chatId, messageId }, 'edu:group:title', {});
}

async function startAddMember(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  groupId: number,
): Promise<void> {
  const messageId = await sendAdminMessage(
    message.chatId,
    `➕ Добавление в группу #${groupId}\n\nВведи Telegram ID ученика:`,
    homeOnlyKeyboard(),
  );
  if (!messageId) return;
  await saveState(admin, telegramId, { chatId: message.chatId, messageId }, 'edu:group:add', {
    targetGroupId: groupId,
  });
}

async function startSetTeacher(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  groupId: number,
): Promise<void> {
  const messageId = await sendAdminMessage(
    message.chatId,
    `👨‍🏫 Преподаватель для группы #${groupId}\n\nВведи Telegram ID преподавателя:`,
    homeOnlyKeyboard(),
  );
  if (!messageId) return;
  await saveState(admin, telegramId, { chatId: message.chatId, messageId }, 'edu:group:teacher-set', {
    targetGroupId: groupId,
  });
}

export async function startScheduleWizard(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
): Promise<void> {
  const label = await memberLabel(admin, studentTelegramId);
  const studentGroups = await getStudentGroups(admin, studentTelegramId);

  const keyboard: InlineButton[][] = [
    [{ text: '👤 Индивидуальное', callback_data: `ae:sched:${studentTelegramId}:kind:individual` }],
  ];
  if (studentGroups.length > 0) {
    for (const group of studentGroups) {
      keyboard.push([
        {
          text: `👥 Групповое · ${shorten(group.title, 24)}`,
          callback_data: `ae:sched:${studentTelegramId}:kind:group:${group.id}`,
        },
      ]);
    }
  } else {
    keyboard.push([
      { text: '👥 Групповое (без группы)', callback_data: `ae:sched:${studentTelegramId}:kind:group:0` },
    ]);
  }
  keyboard.push([{ text: '↩️ Отмена', callback_data: `admin:user:${studentTelegramId}::` }]);

  await editAdminMessage(
    message,
    `📅 Назначить занятие\n\nУченик: ${label}\n\nВыбери формат:`,
    { inline_keyboard: keyboard },
  );
}

async function beginScheduleTopicStep(
  admin: SupabaseClient,
  callerId: number,
  chatId: number,
  payload: ConversationState['payload'],
): Promise<void> {
  const messageId = await sendAdminMessage(chatId, '📅 Тема занятия:', homeOnlyKeyboard());
  if (!messageId) return;
  await saveState(admin, callerId, { chatId, messageId }, 'edu:sched:topic', payload);
}

async function scheduleConfirmText(admin: SupabaseClient, payload: ConversationState['payload']): Promise<string> {
  const studentId = payload.studentTelegramId;
  if (!studentId || !payload.scheduleKind || !payload.scheduleTopic || !payload.scheduleStartsAt) {
    return 'Не хватает данных для назначения.';
  }
  const label = await memberLabel(admin, studentId);
  const lines = [
    '📅 Подтвердить занятие',
    '',
    `👤 ${label}`,
    `📦 ${payload.scheduleKind === 'individual' ? 'Индивидуальное' : 'Групповое'}`,
    `📝 ${payload.scheduleTopic}`,
    `🕐 ${formatDateTime(payload.scheduleStartsAt)}`,
  ];
  if (payload.scheduleMeetUrl) lines.push(`🔗 ${payload.scheduleMeetUrl}`);
  if (payload.scheduleGroupId) lines.push(`👥 Группа #${payload.scheduleGroupId}`);
  return lines.join('\n');
}

function scheduleConfirmKeyboard(studentId: number): InlineButton[][] {
  return [
    [{ text: '✅ Назначить', callback_data: `ae:sched:${studentId}:confirm` }],
    [{ text: '↩️ Отмена', callback_data: `admin:user:${studentId}::` }],
  ];
}

async function confirmSchedule(
  admin: SupabaseClient,
  message: AdminMessage,
  payload: ConversationState['payload'],
): Promise<void> {
  const studentId = payload.studentTelegramId;
  if (!studentId || !payload.scheduleKind || !payload.scheduleTopic || !payload.scheduleStartsAt) {
    await editAdminMessage(message, 'Не хватает данных.', homeOnlyKeyboard());
    return;
  }

  try {
    const groupId = payload.scheduleGroupId && payload.scheduleGroupId > 0 ? payload.scheduleGroupId : undefined;
    let teacherTelegramId: number | undefined;
    if (groupId) {
      const group = await getGroup(admin, groupId);
      teacherTelegramId = group?.teacher_telegram_id ?? undefined;
    }

    const result = await scheduleStudentLesson(admin, studentId, {
      kind: payload.scheduleKind,
      startsAt: payload.scheduleStartsAt,
      topic: payload.scheduleTopic,
      meetUrl: payload.scheduleMeetUrl,
      groupId,
      teacherTelegramId,
    });

    await notifyStudentLessonScheduled(admin, studentId, {
      kind: payload.scheduleKind,
      topic: payload.scheduleTopic,
      startsAt: payload.scheduleStartsAt,
      meetUrl: payload.scheduleMeetUrl,
    });

    await editAdminMessage(
      message,
      [
        '✅ Занятие назначено',
        '',
        `🆔 Урок #${result.lessonId}`,
        `📦 Пакет #${result.packageId}`,
        `👤 ${await memberLabel(admin, studentId)}`,
        '',
        '📲 Ученик уведомлён в Telegram.',
      ].join('\n'),
      {
        inline_keyboard: [[{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }], [homeButton()]],
      },
    );
  } catch (error) {
    const text =
      error instanceof LessonScheduleError
        ? `❌ ${error.message}`
        : '❌ Не удалось назначить занятие.';
    await editAdminMessage(message, text, {
      inline_keyboard: [[{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }], [homeButton()]],
    });
  }
}

export async function handleEducationAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'ae:menu') {
    await renderEducationMenu(editDeliver(message));
    return true;
  }

  if (data.startsWith('ae:groups:')) {
    const page = Number(data.slice('ae:groups:'.length)) || 0;
    await renderGroupsList(admin, message, page);
    return true;
  }

  const groupMatch = data.match(/^ae:g:(\d+)$/);
  if (groupMatch) {
    await renderGroupDetail(admin, message, Number(groupMatch[1]));
    return true;
  }

  const groupAddMatch = data.match(/^ae:g:(\d+):add$/);
  if (groupAddMatch) {
    await startAddMember(admin, telegramId, message, Number(groupAddMatch[1]));
    return true;
  }

  const groupTeacherMatch = data.match(/^ae:g:(\d+):teacher$/);
  if (groupTeacherMatch) {
    await startSetTeacher(admin, telegramId, message, Number(groupTeacherMatch[1]));
    return true;
  }

  if (data === 'ae:g:new') {
    await startCreateGroup(admin, telegramId, message);
    return true;
  }

  if (data === 'ae:g:new:confirm') {
    const state = await getState(admin, telegramId);
    const payload = state?.payload ?? {};
    if (!payload.groupTitle) {
      await editAdminMessage(message, 'Название группы не указано.', homeOnlyKeyboard());
      return true;
    }
    const group = await createGroup(admin, {
      title: payload.groupTitle,
      teacherTelegramId: payload.groupTeacherId ?? null,
      curatorTelegramId: payload.groupCuratorId ?? null,
    });
    await clearState(admin, telegramId);
    await editAdminMessage(message, `✅ Группа создана\n\n${groupCard(group, 0)}`, {
      inline_keyboard: [
        [{ text: 'Открыть', callback_data: `ae:g:${group.id}` }],
        [{ text: '↩️ К списку', callback_data: 'ae:groups:0' }],
        [homeButton()],
      ],
    });
    return true;
  }

  const schedStartMatch = data.match(/^ae:sched:(\d+)$/);
  if (schedStartMatch) {
    await startScheduleWizard(admin, message, Number(schedStartMatch[1]));
    return true;
  }

  const schedKindMatch = data.match(/^ae:sched:(\d+):kind:(individual|group)(?::(\d+))?$/);
  if (schedKindMatch) {
    const studentTelegramId = Number(schedKindMatch[1]);
    const scheduleKind = schedKindMatch[2] as 'individual' | 'group';
    const groupRaw = schedKindMatch[3];
    const scheduleGroupId = groupRaw ? Number(groupRaw) : undefined;
    await beginScheduleTopicStep(admin, telegramId, message.chatId, {
      studentTelegramId,
      scheduleKind,
      scheduleGroupId: scheduleGroupId && scheduleGroupId > 0 ? scheduleGroupId : undefined,
    });
    return true;
  }

  const schedConfirmMatch = data.match(/^ae:sched:(\d+):confirm$/);
  if (schedConfirmMatch) {
    const state = await getState(admin, telegramId);
    await confirmSchedule(admin, message, state?.payload ?? {});
    await clearState(admin, telegramId);
    return true;
  }

  const accessMenuMatch = data.match(/^ae:access:(\d+)$/);
  if (accessMenuMatch) {
    const studentId = Number(accessMenuMatch[1]);
    const keyboard: InlineButton[][] = ACCESS_PRODUCTS.map((product) => [
      {
        text: `➕ ${ACCESS_PRODUCT_LABELS[product]}`,
        callback_data: `ae:access:g:${studentId}:${product}`,
      },
      {
        text: `➖ ${ACCESS_PRODUCT_LABELS[product]}`,
        callback_data: `ae:access:r:${studentId}:${product}`,
      },
    ]);
    keyboard.push([{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }], [homeButton()]);
    await editAdminMessage(message, `📚 Управление доступами\n\nУченик #${studentId}`, {
      inline_keyboard: keyboard,
    });
    return true;
  }

  const accessGrantMatch = data.match(/^ae:access:g:(\d+):(\w+)$/);
  if (accessGrantMatch) {
    const studentId = Number(accessGrantMatch[1]);
    const product = accessGrantMatch[2];
    if (!isAccessProduct(product)) return true;
    await grantAccess(admin, studentId, product);
    await editAdminMessage(message, `✅ Доступ «${ACCESS_PRODUCT_LABELS[product]}» выдан.`, {
      inline_keyboard: [
        [{ text: '↩️ К доступам', callback_data: `ae:access:${studentId}` }],
        [{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }],
        [homeButton()],
      ],
    });
    return true;
  }

  const accessRevokeMatch = data.match(/^ae:access:r:(\d+):(\w+)$/);
  if (accessRevokeMatch) {
    const studentId = Number(accessRevokeMatch[1]);
    const product = accessRevokeMatch[2];
    if (!isAccessProduct(product)) return true;
    const revoked = await revokeAccess(admin, studentId, product);
    await editAdminMessage(
      message,
      revoked ? `✅ Доступ «${ACCESS_PRODUCT_LABELS[product]}» отозван.` : 'ℹ️ Активного доступа не было.',
      {
        inline_keyboard: [
          [{ text: '↩️ К доступам', callback_data: `ae:access:${studentId}` }],
          [{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }],
          [homeButton()],
        ],
      },
    );
    return true;
  }

  const mentorMenuMatch = data.match(/^ae:mentor:(\d+)$/);
  if (mentorMenuMatch) {
    const studentId = Number(mentorMenuMatch[1]);
    const { data: mentors, error } = await admin
      .from('bot_members')
      .select('telegram_id, full_name, role')
      .in('role', ['teacher', 'curator', 'mentor']);
    if (error) throw error;

    const keyboard: InlineButton[][] = (mentors ?? []).map((row) => {
      const kind = row.role === 'teacher' ? 'teacher' : 'curator';
      const label = `${kind === 'teacher' ? '👨‍🏫' : '🎓'} ${row.full_name ?? row.telegram_id}`;
      return [
        {
          text: label,
          callback_data: `ae:mentor:a:${studentId}:${kind}:${row.telegram_id}`,
        },
      ];
    });
    if (keyboard.length === 0) {
      keyboard.push([{ text: '— Наставники не найдены —', callback_data: 'ae:menu' }]);
    }
    keyboard.push([{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }], [homeButton()]);
    await editAdminMessage(message, `👤 Назначить наставника\n\nУченик #${studentId}`, {
      inline_keyboard: keyboard,
    });
    return true;
  }

  const mentorAssignMatch = data.match(/^ae:mentor:a:(\d+):(teacher|curator):(\d+)$/);
  if (mentorAssignMatch) {
    const studentId = Number(mentorAssignMatch[1]);
    const kind = mentorAssignMatch[2] as 'teacher' | 'curator';
    const mentorTelegramId = Number(mentorAssignMatch[3]);
    try {
      if (kind === 'teacher') await assignTeacher(admin, studentId, mentorTelegramId);
      else await assignCurator(admin, studentId, mentorTelegramId);
      const mentor = await getMember(admin, mentorTelegramId);
      await editAdminMessage(
        message,
        `✅ ${kind === 'teacher' ? 'Преподаватель' : 'Куратор'} назначен: ${mentor ? memberDisplayName(mentor) : mentorTelegramId}`,
        {
          inline_keyboard: [
            [{ text: '↩️ К профилю', callback_data: `admin:user:${studentId}::` }],
            [homeButton()],
          ],
        },
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось назначить наставника.';
      await editAdminMessage(message, `❌ ${text}`, {
        inline_keyboard: [
          [{ text: '↩️ Назначить', callback_data: `ae:mentor:${studentId}` }],
          [homeButton()],
        ],
      });
    }
    return true;
  }

  return false;
}

export async function handleEducationTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const input = text.trim();
  const deliver = sendDeliver(state.chat_id);

  if (state.step === 'edu:group:title') {
    if (!input) {
      await deliver('Введи непустое название.');
      return true;
    }
    await persistState(admin, telegramId, state, 'edu:group:teacher', {
      ...state.payload,
      groupTitle: input,
    });
    await deliver('👨‍🏫 Telegram ID преподавателя (или «-» чтобы пропустить):');
    return true;
  }

  if (state.step === 'edu:group:teacher') {
    let groupTeacherId: number | null = null;
    if (input !== '-') {
      groupTeacherId = parseTelegramId(input);
      if (!groupTeacherId) {
        await deliver('Нужен числовой Telegram ID или «-».');
        return true;
      }
    }
    await persistState(admin, telegramId, state, 'edu:group:curator', {
      ...state.payload,
      groupTeacherId: groupTeacherId ?? undefined,
    });
    await deliver('🟡 Telegram ID куратора (или «-» чтобы пропустить):');
    return true;
  }

  if (state.step === 'edu:group:curator') {
    let groupCuratorId: number | null = null;
    if (input !== '-') {
      groupCuratorId = parseTelegramId(input);
      if (!groupCuratorId) {
        await deliver('Нужен числовой Telegram ID или «-».');
        return true;
      }
    }
    const payload = { ...state.payload, groupCuratorId: groupCuratorId ?? undefined };
    const messageId = await sendAdminMessage(
      state.chat_id,
      [
        'Подтвердить создание группы?',
        '',
        `📚 ${payload.groupTitle}`,
        payload.groupTeacherId ? `👨‍🏫 Препод: ${payload.groupTeacherId}` : '👨‍🏫 Препод: не назначен',
        payload.groupCuratorId ? `🟡 Куратор: ${payload.groupCuratorId}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        inline_keyboard: [[{ text: '✅ Создать', callback_data: 'ae:g:new:confirm' }], [homeButton()]],
      },
    );
    if (messageId) {
      await persistState(admin, telegramId, state, 'edu:group:curator', payload, messageId);
    }
    return true;
  }

  if (state.step === 'edu:group:add') {
    const groupId = state.payload.targetGroupId;
    if (!groupId) {
      await clearState(admin, telegramId);
      return true;
    }
    const memberId = parseTelegramId(input);
    if (!memberId) {
      await deliver('Нужен числовой Telegram ID.');
      return true;
    }
    await addStudentToGroup(admin, groupId, memberId);
    await clearState(admin, telegramId);
    await deliver(`✅ Ученик ${memberId} добавлен в группу #${groupId}.`, {
      inline_keyboard: [[{ text: 'Открыть группу', callback_data: `ae:g:${groupId}` }], [homeButton()]],
    });
    return true;
  }

  if (state.step === 'edu:group:teacher-set') {
    const groupId = state.payload.targetGroupId;
    if (!groupId) {
      await clearState(admin, telegramId);
      return true;
    }
    const teacherId = parseTelegramId(input);
    if (!teacherId) {
      await deliver('Нужен числовой Telegram ID преподавателя.');
      return true;
    }
    await updateGroup(admin, groupId, { teacher_telegram_id: teacherId });
    await clearState(admin, telegramId);
    await deliver(`✅ Преподаватель ${teacherId} назначен для группы #${groupId}.`, {
      inline_keyboard: [[{ text: 'Открыть группу', callback_data: `ae:g:${groupId}` }], [homeButton()]],
    });
    return true;
  }

  if (state.step === 'edu:sched:topic') {
    if (!input) {
      await deliver('Введи тему занятия.');
      return true;
    }
    await persistState(admin, telegramId, state, 'edu:sched:datetime', {
      ...state.payload,
      scheduleTopic: input,
    });
    await deliver('🕐 Дата и время (ISO или дд.мм.гггг чч:мм, МСК):');
    return true;
  }

  if (state.step === 'edu:sched:datetime') {
    const startsAt = parseScheduleDateTime(input);
    if (!startsAt) {
      await deliver('Не удалось разобрать дату. Пример: 25.09.2026 18:30');
      return true;
    }
    await persistState(admin, telegramId, state, 'edu:sched:meet', {
      ...state.payload,
      scheduleStartsAt: startsAt,
    });
    await deliver('🔗 Ссылка на созвон (http(s) URL или «-»):');
    return true;
  }

  if (state.step === 'edu:sched:meet') {
    let scheduleMeetUrl: string | undefined;
    if (input !== '-') {
      if (!isValidHttpUrl(input)) {
        await deliver('Нужен http(s) URL или «-».');
        return true;
      }
      scheduleMeetUrl = input;
    }
    const payload = { ...state.payload, scheduleMeetUrl };
    const studentId = payload.studentTelegramId;
    if (!studentId) {
      await clearState(admin, telegramId);
      return true;
    }
    const confirmText = await scheduleConfirmText(admin, payload);
    const messageId = await sendAdminMessage(state.chat_id, confirmText, {
      inline_keyboard: [...scheduleConfirmKeyboard(studentId), [homeButton()]],
    });
    if (messageId) {
      await persistState(admin, telegramId, state, 'edu:sched:meet', payload, messageId);
    }
    return true;
  }

  return false;
}

/** Данные для карточки пользователя: доступы, пакеты, группы. */
export async function loadUserEducationSummary(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{
  accessLines: string[];
  packageLines: string[];
  groupLine: string;
  mentorLines: string[];
}> {
  const [{ data: accesses }, { data: packages }, groups, { data: mentorRows }] = await Promise.all([
    admin.from('user_accesses').select('product, status').eq('telegram_id', telegramId).eq('status', 'active'),
    admin
      .from('lesson_packages')
      .select('product, remaining_lessons, status')
      .eq('telegram_id', telegramId)
      .eq('status', 'active'),
    getStudentGroups(admin, telegramId),
    admin
      .from('mentor_assignments')
      .select('kind, mentor_telegram_id')
      .eq('telegram_id', telegramId)
      .eq('status', 'active'),
  ]);

  const accessLines =
    (accesses ?? []).length > 0
      ? (accesses ?? []).map(
          (row) =>
            `📚 ${ACCESS_PRODUCT_LABELS[row.product as keyof typeof ACCESS_PRODUCT_LABELS] ?? row.product}`,
        )
      : ['📚 Доступы: нет активных'];

  const packageLines =
    (packages ?? []).length > 0
      ? (packages ?? []).map((row) => {
          const label = row.product === 'individual' ? 'Индив' : row.product === 'group' ? 'Группа' : row.product;
          return `📦 ${label}: ${row.remaining_lessons} занятий`;
        })
      : ['📦 Пакеты: нет активных'];

  const groupLine =
    groups.length > 0
      ? `👥 Группа: ${groups.map((g) => g.title).join(', ')}`
      : '👥 Группа: не состоит';

  const mentorLines: string[] = [];
  for (const row of mentorRows ?? []) {
    const mentor = await getMember(admin, row.mentor_telegram_id as number);
    const label = row.kind === 'teacher' ? 'Преподаватель' : 'Куратор';
    mentorLines.push(`🧑‍🏫 ${label}: ${mentor ? memberDisplayName(mentor) : row.mentor_telegram_id}`);
  }
  if (mentorLines.length === 0) mentorLines.push('🧑‍🏫 Наставник: не назначен');

  return { accessLines, packageLines, groupLine, mentorLines };
}
