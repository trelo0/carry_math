import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLessonHomework,
  homeworkReviewStatusLabel,
  type LessonHomeworkReviewStatus,
} from '@/lib/lesson-homework';
import { telegramSend } from '@/lib/telegram';
import { resolveMemberChatId, staffStudentLabel } from '../staff/messaging';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  clearState,
  editAdminMessage,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  saveState,
  sendAdminMessage,
  shorten,
} from './core';

const HW_PER_PAGE = 6;
const MSG_PER_PAGE = 6;
const LONG_PENDING_MS = 3 * 86400000;

export type LessonHwListItem = {
  homeworkId: number;
  lessonId: number;
  reviewStatus: LessonHomeworkReviewStatus;
  topic: string;
  startsAt: string;
  studentTelegramId: number | null;
  studentName: string | null;
  teacherTelegramId: number | null;
  submittedAt: string | null;
};

function isMessagesTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('staff_student_messages');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadPendingLessonHomework(admin: SupabaseClient): Promise<LessonHwListItem[]> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select(
      'id, lesson_id, review_status, submitted_at, scheduled_lessons(topic, starts_at, telegram_id, teacher_telegram_id)',
    )
    .in('review_status', ['submitted', 'reviewing'])
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(80);
  if (error) throw error;

  const studentIds = new Set<number>();
  const rows: LessonHwListItem[] = [];
  for (const row of data ?? []) {
    const lesson = row.scheduled_lessons as
      | { topic: string; starts_at: string; telegram_id: number | null; teacher_telegram_id: number | null }
      | Array<{ topic: string; starts_at: string; telegram_id: number | null; teacher_telegram_id: number | null }>
      | null;
    const l = Array.isArray(lesson) ? lesson[0] : lesson;
    if (!l) continue;
    if (l.telegram_id) studentIds.add(l.telegram_id);
    rows.push({
      homeworkId: row.id as number,
      lessonId: row.lesson_id as number,
      reviewStatus: row.review_status as LessonHomeworkReviewStatus,
      topic: l.topic,
      startsAt: l.starts_at,
      studentTelegramId: l.telegram_id,
      teacherTelegramId: l.teacher_telegram_id,
      submittedAt: (row.submitted_at as string | null) ?? null,
      studentName: null,
    });
  }

  if (studentIds.size > 0) {
    const { data: members } = await admin
      .from('bot_members')
      .select('telegram_id, full_name')
      .in('telegram_id', [...studentIds]);
    const names = new Map<number, string>();
    for (const m of members ?? []) names.set(m.telegram_id as number, (m.full_name as string) ?? '');
    for (const r of rows) {
      if (r.studentTelegramId) r.studentName = names.get(r.studentTelegramId) || null;
    }
  }
  return rows;
}

type UnreadThread = {
  studentTelegramId: number;
  staffTelegramId: number;
  staffRole: string;
  unreadCount: number;
  lastBody: string;
  lastAt: string;
};

async function loadUnreadThreads(admin: SupabaseClient): Promise<UnreadThread[]> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('student_telegram_id, staff_telegram_id, staff_role, body, created_at, direction, staff_read_at')
      .eq('direction', 'student_to_staff')
      .is('staff_read_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const map = new Map<string, UnreadThread>();
    for (const row of data ?? []) {
      const key = `${row.staff_telegram_id}:${row.staff_role}:${row.student_telegram_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.unreadCount += 1;
        continue;
      }
      map.set(key, {
        studentTelegramId: row.student_telegram_id as number,
        staffTelegramId: row.staff_telegram_id as number,
        staffRole: String(row.staff_role),
        unreadCount: 1,
        lastBody: String(row.body ?? ''),
        lastAt: row.created_at as string,
      });
    }
    return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  } catch (error) {
    if (isMessagesTableError(error)) return [];
    throw error;
  }
}

async function loadStudentMessages(
  admin: SupabaseClient,
  studentTelegramId: number,
  limit = 25,
): Promise<Array<{ body: string; createdAt: string; direction: string; staffRole: string }>> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('body, created_at, direction, staff_role')
      .eq('student_telegram_id', studentTelegramId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      body: String(r.body ?? ''),
      createdAt: r.created_at as string,
      direction: String(r.direction),
      staffRole: String(r.staff_role),
    }));
  } catch (error) {
    if (isMessagesTableError(error)) return [];
    throw error;
  }
}

export function isCommsHubAction(data: string): boolean {
  return (
    data.startsWith('ah:hw:') ||
    data.startsWith('ah:msg:') ||
    /^ah:person:\d+:(hw|msg|history)$/.test(data)
  );
}

export async function renderAdminHomeworkQueue(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: 'all' | 'long',
  page: number,
): Promise<void> {
  let items = await loadPendingLessonHomework(admin);
  if (filter === 'long') {
    const cutoff = Date.now() - LONG_PENDING_MS;
    items = items.filter((i) => i.submittedAt && Date.parse(i.submittedAt) < cutoff);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / HW_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = items.slice(safePage * HW_PER_PAGE, (safePage + 1) * HW_PER_PAGE);
  const nav = `${filter}:${safePage}`;

  const keyboard: InlineButton[][] = [
    [
      {
        text: filter === 'all' ? '✅ Все на проверке' : '○ Все на проверке',
        callback_data: 'ah:hw:q:all:0',
      },
      {
        text: filter === 'long' ? '✅ >3 дней' : '○ >3 дней',
        callback_data: 'ah:hw:q:long:0',
      },
    ],
  ];

  for (const item of slice) {
    const who = item.studentName ?? (item.studentTelegramId ? `ID ${item.studentTelegramId}` : '?');
    keyboard.push([
      {
        text: shorten(`${who} · ${item.topic}`, 36),
        callback_data: `ah:hw:d:${item.homeworkId}:${nav}`,
      },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:hw:q:${filter}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:hw:q:${filter}:${safePage + 1}` : 'noop',
      },
    ]);
  }

  keyboard.push(
    [{ text: 'ℹ️ Проверку делает staff в своём боте', callback_data: 'noop' }],
    [homeButton()],
  );

  const title = filter === 'long' ? '📝 ДЗ на проверке >3 дней' : '📝 ДЗ занятий на проверке';
  const lines =
    slice.length === 0
      ? [title, '', 'Очередь пуста.']
      : [
          title,
          '',
          ...slice.map((item, i) => {
            const who = item.studentName ?? (item.studentTelegramId ? `ID ${item.studentTelegramId}` : '?');
            const age = item.submittedAt ? formatDateTime(item.submittedAt) : '—';
            return `${safePage * HW_PER_PAGE + i + 1}. ${who}\n   ${item.topic}\n   ${homeworkReviewStatusLabel(item.reviewStatus)} · сдано ${age}`;
          }),
        ];

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderHomeworkDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  homeworkId: number,
  nav: string,
): Promise<void> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select('id, lesson_id, review_status, submitted_at, submission_text, teacher_comment')
    .eq('id', homeworkId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await editAdminMessage(message, 'ДЗ не найдено.', { inline_keyboard: [[homeButton()]] });
    return;
  }

  const lessonId = data.lesson_id as number;
  const homework = await getLessonHomework(admin, lessonId);
  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('topic, starts_at, telegram_id, teacher_telegram_id')
    .eq('id', lessonId)
    .maybeSingle();

  const studentId = lesson?.telegram_id as number | undefined;

  let studentLabel = '—';
  if (studentId) studentLabel = await staffStudentLabel(admin, studentId);

  const lines = [
    '📝 ДЗ занятия (просмотр)',
    '',
    homework ? `📝 ${homework.fileName}` : `Урок #${data.lesson_id}`,
    lesson?.topic ? `Тема: ${lesson.topic}` : '',
    `Статус: ${homeworkReviewStatusLabel((data.review_status as LessonHomeworkReviewStatus) ?? 'pending')}`,
    data.submitted_at ? `Сдано: ${formatDateTime(data.submitted_at as string)}` : '',
    studentId ? `👤 ${studentLabel}` : '',
    homework?.submissionText ? `Ответ: ${shorten(homework.submissionText, 200)}` : '',
    data.teacher_comment ? `Комментарий staff: ${data.teacher_comment}` : '',
    '',
    'Изменить статус может только преподаватель/куратор в staff-боте.',
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [];
  if (studentId) {
    keyboard.push([{ text: '👤 Карточка ученика', callback_data: `admin:user:${studentId}::` }]);
  }
  keyboard.push([{ text: '◀️ К очереди', callback_data: `ah:hw:q:${nav}` }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderUnreadMessagesHub(
  admin: SupabaseClient,
  deliver: Deliver,
  page: number,
): Promise<void> {
  const threads = await loadUnreadThreads(admin);
  const pageCount = Math.max(1, Math.ceil(threads.length / MSG_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = threads.slice(safePage * MSG_PER_PAGE, (safePage + 1) * MSG_PER_PAGE);

  const keyboard: InlineButton[][] = slice.map((t) => [
    {
      text: shorten(`${t.unreadCount} · ${t.lastBody}`, 34),
      callback_data: `ah:msg:t:${t.studentTelegramId}:${t.staffTelegramId}:${t.staffRole}:${safePage}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:msg:u:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:msg:u:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([homeButton()]);

  const lines =
    slice.length === 0
      ? ['💬 Непрочитанные (staff)', '', 'Нет непрочитанных от учеников.']
      : [
          '💬 Непрочитанные (staff)',
          '',
          ...(await Promise.all(
            slice.map(async (t, i) => {
              const student = await staffStudentLabel(admin, t.studentTelegramId);
              return `${safePage * MSG_PER_PAGE + i + 1}. ${student}\n   ${t.staffRole} · ${t.unreadCount} нов.\n   ${shorten(t.lastBody, 80)}`;
            }),
          )),
        ];

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderThreadView(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
  backPage: number,
): Promise<void> {
  const messages = await loadStudentMessages(admin, studentTelegramId, 20);
  const student = await staffStudentLabel(admin, studentTelegramId);
  const lines = ['💬 Переписка (read-only)', '', student, ''];
  if (messages.length === 0) {
    lines.push('Сообщений нет или таблица не мигрирована.');
  } else {
    for (const m of [...messages].reverse()) {
      const who = m.direction === 'student_to_staff' ? '👤' : `👔 ${m.staffRole}`;
      lines.push(`${who} ${formatDateTime(m.createdAt)}`);
      lines.push(shorten(m.body, 300));
      lines.push('');
    }
  }

  const keyboard: InlineButton[][] = [
    [{ text: '✉️ Написать ученику', callback_data: `ah:msg:w:${studentTelegramId}` }],
    [{ text: '👤 Карточка', callback_data: `admin:user:${studentTelegramId}::` }],
    [{ text: '◀️ Непрочитанные', callback_data: `ah:msg:u:${backPage}` }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n').trim(), { inline_keyboard: keyboard });
}

async function renderStudentHomeworkList(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select('id, lesson_id, review_status, submitted_at, scheduled_lessons!inner(topic, telegram_id)')
    .eq('scheduled_lessons.telegram_id', studentTelegramId)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(15);
  if (error) {
    await editAdminMessage(message, 'Не удалось загрузить ДЗ.', { inline_keyboard: [[homeButton()]] });
    return;
  }

  const student = await staffStudentLabel(admin, studentTelegramId);
  const lines = ['📝 ДЗ занятий', '', student, ''];
  const keyboard: InlineButton[][] = [];

  for (const row of data ?? []) {
    const lesson = row.scheduled_lessons as { topic: string } | { topic: string }[];
    const topic = (Array.isArray(lesson) ? lesson[0] : lesson)?.topic ?? '—';
    const status = homeworkReviewStatusLabel(row.review_status as LessonHomeworkReviewStatus);
    lines.push(`• ${topic} — ${status}`);
    keyboard.push([
      {
        text: shorten(`${topic} · ${status}`, 32),
        callback_data: `ah:hw:d:${row.id}:all:0`,
      },
    ]);
  }
  if ((data ?? []).length === 0) lines.push('Нет домашних заданий по занятиям.');

  keyboard.push(
    [{ text: '↩️ К профилю', callback_data: `admin:user:${studentTelegramId}::` }],
    [homeButton()],
  );
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderStudentHistory(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
): Promise<void> {
  const [messages, hwRows] = await Promise.all([
    loadStudentMessages(admin, studentTelegramId, 8),
    admin
      .from('homework_assignments')
      .select('review_status, submitted_at, scheduled_lessons!inner(topic, telegram_id)')
      .eq('scheduled_lessons.telegram_id', studentTelegramId)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(5),
  ]);

  const student = await staffStudentLabel(admin, studentTelegramId);
  const lines = ['📜 История (кратко)', '', student, '', 'ДЗ:'];
  for (const row of hwRows.data ?? []) {
    const lesson = row.scheduled_lessons as { topic: string } | { topic: string }[];
    const topic = (Array.isArray(lesson) ? lesson[0] : lesson)?.topic ?? '—';
    lines.push(
      `• ${topic} — ${homeworkReviewStatusLabel(row.review_status as LessonHomeworkReviewStatus)} (${row.submitted_at ? formatDateTime(row.submitted_at as string) : ''})`,
    );
  }
  lines.push('', 'Сообщения:');
  if (messages.length === 0) lines.push('—');
  else {
    for (const m of messages.slice(0, 5)) {
      lines.push(`• ${formatDateTime(m.createdAt)}: ${shorten(m.body, 60)}`);
    }
  }

  await editAdminMessage(message, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '📝 Все ДЗ', callback_data: `ah:person:${studentTelegramId}:hw` }],
      [{ text: '💬 Переписка', callback_data: `ah:person:${studentTelegramId}:msg` }],
      [{ text: '↩️ К профилю', callback_data: `admin:user:${studentTelegramId}::` }],
      [homeButton()],
    ],
  });
}

async function startAdminMessageToStudent(
  admin: SupabaseClient,
  adminTelegramId: number,
  message: AdminMessage,
  studentTelegramId: number,
): Promise<void> {
  const label = await staffStudentLabel(admin, studentTelegramId);
  await saveState(admin, adminTelegramId, message, 'admin:msg:compose', {
    adminMsgStudentId: studentTelegramId,
  });
  await editAdminMessage(message, `✉️ Сообщение ученику\n\n${label}\n\nВведите текст (от имени школы, без записи в staff-чат):`, {
    inline_keyboard: [
      [{ text: '⬅️ Отмена', callback_data: `ah:person:${studentTelegramId}:msg` }],
      [homeButton()],
    ],
  });
}

export async function handleCommsHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  adminTelegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  const personMatch = data.match(/^ah:person:(\d+):(hw|msg|history)$/);
  if (personMatch) {
    const studentId = Number(personMatch[1]);
    const kind = personMatch[2];
    if (kind === 'hw') await renderStudentHomeworkList(admin, message, studentId);
    else if (kind === 'msg') await renderThreadView(admin, message, studentId, 0);
    else await renderStudentHistory(admin, message, studentId);
    return true;
  }

  if (data === 'ah:hw:menu' || data === 'ah:hw:pending') {
    await renderAdminHomeworkQueue(admin, deliver, 'all', 0);
    return true;
  }

  const hwQueue = data.match(/^ah:hw:q:(all|long):(\d+)$/);
  if (hwQueue) {
    await renderAdminHomeworkQueue(admin, deliver, hwQueue[1] as 'all' | 'long', Number(hwQueue[2]) || 0);
    return true;
  }

  const hwDetail = data.match(/^ah:hw:d:(\d+):(all|long):(\d+)$/);
  if (hwDetail) {
    await renderHomeworkDetail(admin, message, Number(hwDetail[1]), `${hwDetail[2]}:${hwDetail[3]}`);
    return true;
  }

  if (data === 'ah:msg:menu' || data === 'ah:msg:unread') {
    await renderUnreadMessagesHub(admin, deliver, 0);
    return true;
  }

  const msgPage = data.match(/^ah:msg:u:(\d+)$/);
  if (msgPage) {
    await renderUnreadMessagesHub(admin, deliver, Number(msgPage[1]) || 0);
    return true;
  }

  const threadMatch = data.match(/^ah:msg:t:(\d+):(\d+):(teacher|curator):(\d+)$/);
  if (threadMatch) {
    await renderThreadView(admin, message, Number(threadMatch[1]), Number(threadMatch[4]) || 0);
    return true;
  }

  const writeMatch = data.match(/^ah:msg:w:(\d+)$/);
  if (writeMatch) {
    await startAdminMessageToStudent(admin, adminTelegramId, message, Number(writeMatch[1]));
    return true;
  }

  return false;
}

export async function handleAdminComposeMessageStep(
  admin: SupabaseClient,
  adminTelegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  if (state.step !== 'admin:msg:compose') return false;
  const studentId = state.payload.adminMsgStudentId;
  if (!studentId) {
    await clearState(admin, adminTelegramId);
    return true;
  }
  const body = text.trim();
  if (!body) {
    await sendAdminMessage(state.chat_id, 'Введите непустой текст.');
    return true;
  }
  const chatId = await resolveMemberChatId(admin, studentId);
  if (!chatId) {
    await clearState(admin, adminTelegramId);
    await sendAdminMessage(state.chat_id, 'У ученика нет chat_id — бот не может написать.', homeOnlyKeyboard());
    return true;
  }
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: `💬 Сообщение от администрации:\n\n${body}`,
  });
  await clearState(admin, adminTelegramId);
  await sendAdminMessage(
    state.chat_id,
    result.ok ? '✅ Сообщение отправлено.' : `❌ Не удалось: ${result.description ?? 'ошибка'}`,
    {
      inline_keyboard: [
        [{ text: '↩️ К ученику', callback_data: `admin:user:${studentId}::` }],
        [homeButton()],
      ],
    },
  );
  return true;
}
