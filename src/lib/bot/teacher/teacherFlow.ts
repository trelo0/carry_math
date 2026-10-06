import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type AdminPayload,
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
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { getLessonHomework } from '@/lib/lesson-homework';
import { loadStaffCapabilities } from '../staff/capabilities';
import { COMBINED_HOME_TEXT } from '../staff/staff-combined-flow';
import {
  COMBINED_TEACHER_HW_NAV,
  COMBINED_TEACHER_MSG_NAV,
  type StaffScreenNav,
} from '../staff/staff-screen-nav';
import {
  isStaffMenuLabel,
  resolveStaffBotMode,
  staffReplyKeyboard,
  TEACHER_BOT_MENU_LABELS,
} from '../staff/staff-menu';
import { clearConflictingStaffStates } from '../staff/staff-reply-state';
import {
  STAFF_TEACHER_HW_REVISION_STEP,
  STAFF_TEACHER_REPLY_STEP,
} from '../staff/staff-steps';
import {
  deliverStaffToStudent,
  listTeacherThreads,
  loadThreadMessages,
  markTeacherThreadRead,
  staffStudentLabel,
} from '../staff/messaging';
import {
  approveTeacherHomework,
  filterHomeworkByQueue,
  loadTeacherHomeworkItems,
  renderHomeworkCardText,
  revisionTeacherHomework,
  sendHomeworkSubmissionPreview,
  type TeacherHomeworkQueueKind,
} from '../staff/teacher-homework';
import {
  renderTeacherHomeworkCardActions,
  renderTeacherHomeworkHub,
  renderTeacherHomeworkList,
  renderTeacherMessagesInbox,
  renderTeacherMessageThread,
  renderTeacherUnreadMessagesInbox,
} from '../staff/teacher-messages-screens';
import {
  findGroup,
  findLesson,
  findStudent,
  loadTeacherBotSnapshot,
} from '../staff/teacher-data';
import {
  notFoundKeyboard,
  renderTeacherGroupCard,
  renderTeacherGroupList,
  renderTeacherGroupMemberCard,
  renderTeacherGroupMembers,
  renderTeacherIndividualList,
  renderTeacherLessonCard,
  renderTeacherScheduleHome,
  renderTeacherScheduleToday,
  renderTeacherScheduleUpcoming,
  renderTeacherStudentCard,
  renderTeacherStudentsHub,
} from '../staff/teacher-screens';
import { formatTelegramFileRef } from '../studentHomeworkFlow';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';

export { STAFF_TEACHER_REPLY_STEP, STAFF_TEACHER_HW_REVISION_STEP } from '../staff/staff-steps';

type ReplyPayload = AdminPayload & { studentTelegramId?: number };
type HwRevisionPayload = AdminPayload & { lessonId?: number };

export const TEACHER_MENU_LABELS = TEACHER_BOT_MENU_LABELS;

export const TEACHER_MENU_LABEL_SET = new Set<string>(Object.values(TEACHER_MENU_LABELS));

const TEACHER_HOME_TEXT =
  '👋 Добро пожаловать в рабочий кабинет District!\n\n' +
  'Здесь вы можете посмотреть своих учеников, расписание, домашние задания и сообщения.\n\n' +
  'Выберите нужный раздел:';

const TEACHER_UNKNOWN_TEXT =
  'Я не понял это сообщение.\n\nРазделы кабинета — на кнопках меню под полем ввода.';

export function teacherReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [
        { text: TEACHER_MENU_LABELS.schedule },
        { text: TEACHER_MENU_LABELS.students },
      ],
      [
        { text: TEACHER_MENU_LABELS.messages },
        { text: TEACHER_MENU_LABELS.homework },
      ],
      [{ text: TEACHER_MENU_LABELS.cabinet }],
    ],
    resize_keyboard: true,
  };
}

export async function sendTeacherStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: TEACHER_HOME_TEXT + testFooter,
    reply_markup: staffReplyKeyboard(caps),
  });
}

async function canUseTeacherBot(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  return caps.canTeacherBot;
}

async function teacherCabinetUrl(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  try {
    return await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
  } catch {
    return null;
  }
}

export async function teacherCabinetScreen(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const url = await teacherCabinetUrl(admin, telegramId);
  return {
    text: '🌐 Панель управления\n\nРасписание, группы и домашние задания — на сайте:',
    keyboard: {
      inline_keyboard: [
        ...(url ? [[{ text: '🌐 Открыть кабинет', url }]] : []),
        [{ text: '⬅️ Главное меню', callback_data: 't:menu' }],
      ],
    },
  };
}

async function editTeacherScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard): Promise<void> {
  await editAdminMessage(message, text, keyboard);
}

async function beginTeacherReply(
  admin: SupabaseClient,
  teacherTelegramId: number,
  chatId: number,
  studentTelegramId: number,
): Promise<void> {
  const ok = await teacherOwnsStudent(admin, teacherTelegramId, studentTelegramId);
  if (!ok) {
    await sendAdminMessage(chatId, 'Нет доступа к этому ученику.');
    return;
  }
  await clearConflictingStaffStates(admin, teacherTelegramId, 'teacher_reply');
  const label = await staffStudentLabel(admin, studentTelegramId);
  try {
    await saveState(
      admin,
      teacherTelegramId,
      { chatId, messageId: 0 },
      STAFF_TEACHER_REPLY_STEP as never,
      { studentTelegramId } as never,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
    return;
  }
  await sendAdminMessage(
    chatId,
    `✏️ Сообщение для ${label}\n\nВведите текст или отправьте фото/документ.\n\nОтмена — «Отмена».`,
    { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: `t:msg:d:${studentTelegramId}` }]] },
  );
}

export async function handleTeacherMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await canUseTeacherBot(admin, telegramId))) return false;
  const caps = await loadStaffCapabilities(admin, telegramId);
  const staffMode = resolveStaffBotMode(caps);

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  const step = state?.step as string | undefined;

  if (state && step === STAFF_TEACHER_REPLY_STEP) {
    const payload = state.payload as ReplyPayload;
    const studentId = payload.studentTelegramId;
    if (!studentId) return false;
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Отправка отменена.');
      return true;
    }
    try {
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'teacher',
        studentTelegramId: studentId,
        body: text.trim(),
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Сообщение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  if (state && step === STAFF_TEACHER_HW_REVISION_STEP) {
    const payload = state.payload as HwRevisionPayload;
    const lessonId = payload.lessonId;
    if (!lessonId) return false;
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Отменено.');
      return true;
    }
    if (!text.trim()) {
      await sendAdminMessage(chatId, 'Нужен комментарий для возврата на доработку.');
      return true;
    }
    try {
      await revisionTeacherHomework(admin, telegramId, lessonId, text.trim());
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Работа возвращена на доработку. Ученик получит уведомление.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось сохранить.');
    }
    return true;
  }

  if (staffMode === 'combined') return false;

  if (!TEACHER_MENU_LABEL_SET.has(text)) {
    if (state && (step === STAFF_TEACHER_REPLY_STEP || step === STAFF_TEACHER_HW_REVISION_STEP)) {
      return false;
    }
    await sendAdminMessage(chatId, TEACHER_UNKNOWN_TEXT);
    return true;
  }

  if (text === TEACHER_MENU_LABELS.cabinet) {
    const cabinet = await teacherCabinetScreen(admin, telegramId);
    await sendAdminMessage(chatId, cabinet.text, cabinet.keyboard);
    return true;
  }

  const cabinetUrl = await teacherCabinetUrl(admin, telegramId);

  if (text === TEACHER_MENU_LABELS.messages) {
    const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
    const screen = renderTeacherMessagesInbox(threads, storageEnabled, cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }

  if (text === TEACHER_MENU_LABELS.homework) {
    const screen = renderTeacherHomeworkHub(cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }

  const snapshot = await loadTeacherBotSnapshot(admin, telegramId);

  if (text === TEACHER_MENU_LABELS.schedule) {
    const screen = renderTeacherScheduleHome(snapshot);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }

  const screen = renderTeacherStudentsHub();
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
  return true;
}

export async function handleTeacherAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  attachment: { fileId: string; kind: 'photo' | 'document' },
): Promise<boolean> {
  if (!(await canUseTeacherBot(admin, telegramId))) return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || (state.step as string) !== STAFF_TEACHER_REPLY_STEP) return false;

  const payload = state.payload as ReplyPayload;
  const studentId = payload.studentTelegramId;
  if (!studentId) return false;

  try {
    await deliverStaffToStudent(admin, {
      staffTelegramId: telegramId,
      staffRole: 'teacher',
      studentTelegramId: studentId,
      body: '',
      attachmentRef: formatTelegramFileRef(attachment.fileId),
      attachmentKind: attachment.kind,
    });
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, '✅ Вложение отправлено ученику.');
  } catch (error) {
    await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
  }
  return true;
}

export async function handleTeacherCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('t:')) return false;
  if (!(await canUseTeacherBot(admin, telegramId))) return false;

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
  const [, action, id, subId, subSubId] = parts;
  const cabinetUrl = await teacherCabinetUrl(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const combined = resolveStaffBotMode(caps) === 'combined';
  const hwNav: StaffScreenNav | undefined = combined ? COMBINED_TEACHER_HW_NAV : undefined;
  const msgNav: StaffScreenNav | undefined = combined ? COMBINED_TEACHER_MSG_NAV : undefined;

  switch (action) {
    case 'menu': {
      if (combined) {
        await editTeacherScreen(message, COMBINED_HOME_TEXT, { inline_keyboard: [] });
      } else {
        await editTeacherScreen(message, TEACHER_HOME_TEXT, { inline_keyboard: [] });
      }
      return true;
    }

    case 'sch': {
      const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
      if (id === 'today') {
        const screen = renderTeacherScheduleToday(snapshot);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'up') {
        const screen = renderTeacherScheduleUpcoming(snapshot);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const screen = renderTeacherScheduleHome(snapshot);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'les': {
      const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
      const lessonId = Number(id);
      const lesson = Number.isFinite(lessonId) ? findLesson(snapshot, lessonId) : undefined;
      if (!lesson) {
        await editTeacherScreen(message, 'Занятие не найдено.', notFoundKeyboard('Расписание', 't:sch'));
        return true;
      }
      const screen = renderTeacherLessonCard(snapshot, lesson);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'stu': {
      if (id === 'i') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherIndividualList(snapshot);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'g') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherGroupList(snapshot);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const hub = renderTeacherStudentsHub();
      await editTeacherScreen(message, hub.text, hub.keyboard);
      return true;
    }

    case 'st': {
      const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
      const studentId = Number(id);
      const student = Number.isFinite(studentId) ? findStudent(snapshot, studentId) : undefined;
      if (!student) {
        await editTeacherScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 't:stu:i'));
        return true;
      }
      const screen = renderTeacherStudentCard(snapshot, student);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'gr':
    case 'gm':
    case 'gs': {
      const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
      if (action === 'gr') {
        const groupId = Number(id);
        const group = Number.isFinite(groupId) ? findGroup(snapshot, groupId) : undefined;
        if (!group) {
          await editTeacherScreen(message, 'Группа не найдена.', notFoundKeyboard('Назад', 't:stu:g'));
          return true;
        }
        const screen = renderTeacherGroupCard(group);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (action === 'gm') {
        const groupId = Number(id);
        const group = Number.isFinite(groupId) ? findGroup(snapshot, groupId) : undefined;
        if (!group) {
          await editTeacherScreen(message, 'Группа не найдена.', notFoundKeyboard('Назад', 't:stu:g'));
          return true;
        }
        const screen = renderTeacherGroupMembers(group);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const groupId = Number(id);
      const memberId = Number(subId);
      const group = Number.isFinite(groupId) ? findGroup(snapshot, groupId) : undefined;
      if (!group || !Number.isFinite(memberId)) {
        await editTeacherScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 't:stu:g'));
        return true;
      }
      const screen = renderTeacherGroupMemberCard(snapshot, group, memberId);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'msg': {
      if (id === 'l') {
        const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
        const screen = renderTeacherMessagesInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'u') {
        const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
        const screen = renderTeacherUnreadMessagesInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'd' && subId) {
        const studentId = Number(subId);
        if (!Number.isFinite(studentId)) return true;
        await markTeacherThreadRead(admin, telegramId, studentId);
        const label = await staffStudentLabel(admin, studentId);
        const { messages, storageEnabled } = await loadThreadMessages(admin, telegramId, studentId);
        const screen = renderTeacherMessageThread(
          label,
          [],
          storageEnabled,
          cabinetUrl,
          studentId,
          msgNav,
        );
        await editTeacherScreen(message, screen.text, screen.keyboard);
        if (storageEnabled && messages.length > 0) {
          for (const msg of messages.slice(-15)) {
            const who = msg.direction === 'student_to_staff' ? label.split(' ')[0] : 'Вы';
            const time = new Date(msg.createdAt).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              hour: '2-digit',
              minute: '2-digit',
            });
            await sendAdminMessage(
              message.chatId,
              `${time} · ${who}\n${msg.body || '(вложение)'}`,
            );
          }
        }
        return true;
      }
      if (id === 'w' && subId) {
        const studentId = Number(subId);
        if (!Number.isFinite(studentId)) return true;
        await beginTeacherReply(admin, telegramId, message.chatId, studentId);
        return true;
      }
      if (id && !subId) {
        const studentId = Number(id);
        if (Number.isFinite(studentId)) {
          await beginTeacherReply(admin, telegramId, message.chatId, studentId);
          return true;
        }
      }
      return true;
    }

    case 'hw': {
      if (id === 'q' && subId) {
        const queue = subId as TeacherHomeworkQueueKind;
        const items = filterHomeworkByQueue(await loadTeacherHomeworkItems(admin, telegramId), queue);
        const screen = renderTeacherHomeworkList(queue, items, cabinetUrl, hwNav);
        await editTeacherScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'i' && subId) {
        const lessonId = Number(subId);
        const items = await loadTeacherHomeworkItems(admin, telegramId);
        const item = items.find((i) => i.lessonId === lessonId);
        if (!item) {
          await editTeacherScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 't:hw'));
          return true;
        }
        const homework = await getLessonHomework(admin, lessonId);
        const canReview = item.reviewStatus === 'submitted' || item.reviewStatus === 'reviewing';
        const text = renderHomeworkCardText(item, homework);
        const keyboard = renderTeacherHomeworkCardActions(lessonId, canReview, cabinetUrl);
        await editTeacherScreen(message, text, keyboard);
        return true;
      }
      if (id === 'v' && subId) {
        const lessonId = Number(subId);
        await sendHomeworkSubmissionPreview(admin, message.chatId, lessonId);
        return true;
      }
      if (id === 'ok' && subId) {
        const lessonId = Number(subId);
        try {
          await approveTeacherHomework(admin, telegramId, lessonId);
          await sendAdminMessage(message.chatId, '✅ Домашнее задание принято.');
        } catch (error) {
          await sendAdminMessage(message.chatId, error instanceof Error ? error.message : 'Ошибка.');
        }
        return true;
      }
      if (id === 'rev' && subId) {
        const lessonId = Number(subId);
        try {
          await saveState(
            admin,
            telegramId,
            { chatId: message.chatId, messageId: message.messageId },
            STAFF_TEACHER_HW_REVISION_STEP as never,
            { lessonId } as never,
          );
          await sendAdminMessage(
            message.chatId,
            '✏️ Комментарий для ученика (обязателен):\n\nОтмена — «Отмена».',
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }
      const hub = renderTeacherHomeworkHub(cabinetUrl, hwNav);
      await editTeacherScreen(message, hub.text, hub.keyboard);
      return true;
    }

    case 'cab': {
      const screen = await teacherCabinetScreen(admin, telegramId);
      await editTeacherScreen(message, screen.text, screen.keyboard);
      return true;
    }

    default:
      return false;
  }
}

export {
  renderTeacherScheduleHome,
  renderTeacherIndividualList,
  renderTeacherStudentCard,
  renderTeacherGroupList,
  renderTeacherGroupCard,
  renderTeacherGroupMembers,
  renderTeacherGroupMemberCard,
} from '../staff/teacher-screens';
