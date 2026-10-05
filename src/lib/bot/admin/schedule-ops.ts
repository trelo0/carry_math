import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelScheduledLesson } from '@/lib/bot/lessons';
import { getMember } from '@/lib/bot/roles';
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
import { memberDisplayName } from './users';
import { listMentorPickerCandidates } from './staff-roster';
import { logAdminAction } from './action-log';
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

const LESSONS_PER_PAGE = 8;
const COURSE_STUDENTS_PER_PAGE = 8;
const TEACHERS_PER_PAGE = 8;

export type AdminLessonRow = {
  id: number;
  telegram_id: number;
  teacher_telegram_id: number | null;
  group_id: number | null;
  kind: string;
  topic: string;
  starts_at: string;
  status: string;
  meet_url: string | null;
};

export function isScheduleListAction(data: string): boolean {
  return data.startsWith('ae:ls:');
}

function weekRange(weekOffset: number): { fromIso: string; toIso: string; label: string } {
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const now = Date.now();
  const mskMidnight = Math.floor((now + mskOffset) / msDay) * msDay - mskOffset;
  const dayUtc = new Date(mskMidnight + mskOffset).getUTCDay();
  const daysFromMonday = (dayUtc + 6) % 7;
  const monday = mskMidnight - daysFromMonday * msDay + weekOffset * 7 * msDay;
  const nextMonday = monday + 7 * msDay;
  const from = new Date(monday);
  const to = new Date(nextMonday);
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    label: `${fmt(from)} – ${fmt(new Date(nextMonday - 1))}`,
  };
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function lessonLine(lesson: AdminLessonRow, index: number): string {
  const kind = lesson.kind === 'group' ? '👥' : '👤';
  const st = lesson.status === 'scheduled' ? '' : ` · ${lesson.status}`;
  return `${index}. ${kind} ${formatTime(lesson.starts_at)} · ${shorten(lesson.topic, 28)}${st}`;
}

function navSuffix(weekOffset: number, teacherId: number): string {
  return `${weekOffset}:${teacherId || 0}`;
}

function parseNav(parts: string[]): { weekOffset: number; teacherId: number } {
  return {
    weekOffset: Number(parts[0]) || 0,
    teacherId: Number(parts[1]) || 0,
  };
}

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  return member ? memberDisplayName(member) : `ID ${telegramId}`;
}

async function listWeekLessons(
  admin: SupabaseClient,
  weekOffset: number,
  teacherId: number,
): Promise<AdminLessonRow[]> {
  const { fromIso, toIso } = weekRange(weekOffset);
  let query = admin
    .from('scheduled_lessons')
    .select(
      'id, telegram_id, teacher_telegram_id, group_id, kind, topic, starts_at, status, meet_url',
    )
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: true })
    .limit(100);
  if (teacherId > 0) query = query.eq('teacher_telegram_id', teacherId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AdminLessonRow[];
}

async function getLesson(admin: SupabaseClient, lessonId: number): Promise<AdminLessonRow | null> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(
      'id, telegram_id, teacher_telegram_id, group_id, kind, topic, starts_at, status, meet_url',
    )
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as AdminLessonRow) : null;
}

async function rescheduleLessonStartsAt(
  admin: SupabaseClient,
  lessonId: number,
  startsAt: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('scheduled_lessons')
    .update({ starts_at: startsAt, updated_at: now })
    .eq('id', lessonId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function renderScheduleWeekMenu(
  admin: SupabaseClient,
  deliver: Deliver,
  weekOffset = 0,
  teacherId = 0,
): Promise<void> {
  const range = weekRange(weekOffset);
  const lessons = await listWeekLessons(admin, weekOffset, teacherId);
  const teacherHint =
    teacherId > 0 ? `\nФильтр: ${await memberLabel(admin, teacherId)}` : '';
  const lines = [
    '📅 Расписание (неделя)',
    range.label + teacherHint,
    '',
    lessons.length === 0 ? 'Занятий нет.' : lessons.map((l, i) => lessonLine(l, i + 1)).join('\n'),
  ];

  const nav = navSuffix(weekOffset, teacherId);
  const keyboard: InlineButton[][] = lessons.slice(0, LESSONS_PER_PAGE).map((l) => [
    {
      text: `${formatTime(l.starts_at)} · ${shorten(l.topic, 22)}`,
      callback_data: `ae:ls:l:${l.id}:${nav}`,
    },
  ]);

  keyboard.push([
    {
      text: weekOffset > -2 ? '⬅️ Неделя' : '·',
      callback_data: weekOffset > -2 ? `ae:ls:w:${navSuffix(weekOffset - 1, teacherId)}` : 'noop',
    },
    { text: weekOffset === 0 ? 'Текущая' : `+${weekOffset}`, callback_data: 'noop' },
    {
      text: weekOffset < 4 ? 'Неделя ➡️' : '·',
      callback_data: weekOffset < 4 ? `ae:ls:w:${navSuffix(weekOffset + 1, teacherId)}` : 'noop',
    },
  ]);

  if (teacherId > 0) {
    keyboard.push([{ text: '✖️ Все преподаватели', callback_data: `ae:ls:w:${navSuffix(weekOffset, 0)}` }]);
  } else {
    keyboard.push([{ text: '👨‍🏫 Фильтр по преподавателю', callback_data: `ae:ls:tp:${weekOffset}:0` }]);
  }

  keyboard.push(
    [{ text: '↩️ Учёба', callback_data: 'ae:menu' }],
    [homeButton()],
  );

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderTeacherPickerForSchedule(
  admin: SupabaseClient,
  message: AdminMessage,
  weekOffset: number,
  page: number,
): Promise<void> {
  const teachers = await listMentorPickerCandidates(admin, 'teacher');
  const from = page * TEACHERS_PER_PAGE;
  const slice = teachers.slice(from, from + TEACHERS_PER_PAGE);
  const keyboard: InlineButton[][] = slice.map((t) => [
    {
      text: shorten(t.full_name?.trim() || `ID ${t.telegram_id}`, 34),
      callback_data: `ae:ls:w:${navSuffix(weekOffset, t.telegram_id)}`,
    },
  ]);
  if (page > 0) {
    keyboard.push([{ text: '◀️', callback_data: `ae:ls:tp:${weekOffset}:${page - 1}` }]);
  }
  if (from + slice.length < teachers.length) {
    keyboard.push([{ text: '▶️', callback_data: `ae:ls:tp:${weekOffset}:${page + 1}` }]);
  }
  keyboard.push([{ text: '↩️ Расписание', callback_data: `ae:ls:w:${navSuffix(weekOffset, 0)}` }], [homeButton()]);
  await editAdminMessage(message, '📅 Выберите преподавателя для фильтра:', {
    inline_keyboard: keyboard,
  });
}

async function renderLessonDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  lesson: AdminLessonRow,
  nav: string,
): Promise<void> {
  const studentLabel = await memberLabel(admin, lesson.telegram_id);
  const teacherLabel = lesson.teacher_telegram_id
    ? await memberLabel(admin, lesson.teacher_telegram_id)
    : '—';
  const lines = [
    `📅 Занятие #${lesson.id}`,
    '',
    `📝 ${lesson.topic}`,
    `🕐 ${formatDateTime(lesson.starts_at)}`,
    `📦 ${lesson.kind === 'group' ? 'Групповое' : 'Индивидуальное'}`,
    `👤 Ученик: ${studentLabel}`,
    `👨‍🏫 Препод: ${teacherLabel}`,
    lesson.group_id ? `👥 Группа #${lesson.group_id}` : '',
    lesson.meet_url ? `🔗 ${lesson.meet_url}` : '',
    `Статус: ${lesson.status}`,
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [];
  if (lesson.status === 'scheduled') {
    keyboard.push(
      [{ text: '🕐 Перенести', callback_data: `ae:ls:rs:${lesson.id}:${nav}` }],
      [{ text: '❌ Отменить', callback_data: `ae:ls:cx:${lesson.id}:${nav}` }],
    );
  }
  keyboard.push(
    [{ text: '👤 Карточка ученика', callback_data: `admin:user:${lesson.telegram_id}::` }],
    [{ text: '◀️ К расписанию', callback_data: `ae:ls:w:${nav}` }],
    [homeButton()],
  );

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function listCourseStudents(
  admin: SupabaseClient,
  page: number,
): Promise<{ rows: Array<{ telegram_id: number; full_name: string | null }>; total: number }> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('telegram_id, bot_members(full_name)')
    .eq('product', 'course')
    .eq('status', 'active')
    .order('telegram_id', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []).map((row) => {
    const raw = row as unknown as {
      telegram_id: number;
      bot_members: { full_name: string | null } | { full_name: string | null }[] | null;
    };
    const bm = Array.isArray(raw.bot_members) ? raw.bot_members[0] : raw.bot_members;
    return {
      telegram_id: raw.telegram_id,
      full_name: bm?.full_name ?? null,
    };
  });
  const from = page * COURSE_STUDENTS_PER_PAGE;
  return { rows: rows.slice(from, from + COURSE_STUDENTS_PER_PAGE), total: rows.length };
}

async function renderCourseStudentsHub(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const { rows, total } = await listCourseStudents(admin, page);
  const pageCount = Math.max(1, Math.ceil(total / COURSE_STUDENTS_PER_PAGE));
  const lines = [
    '🎓 Курсовое обучение',
    '',
    `Учеников с доступом «курс»: ${total}`,
    '',
    rows.length === 0
      ? 'Пока никого.'
      : rows.map((r, i) => `${page * COURSE_STUDENTS_PER_PAGE + i + 1}. ${r.full_name ?? `ID ${r.telegram_id}`}`).join('\n'),
    '',
    'Редактирование модулей — в кабинете на сайте.',
  ];

  const keyboard: InlineButton[][] = rows.map((r) => [
    {
      text: shorten(r.full_name?.trim() || `ID ${r.telegram_id}`, 32),
      callback_data: `admin:user:${r.telegram_id}::`,
    },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      {
        text: page > 0 ? '⬅️' : '·',
        callback_data: page > 0 ? `ae:ls:course:${page - 1}` : 'noop',
      },
      { text: `${page + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: page < pageCount - 1 ? '➡️' : '·',
        callback_data: page < pageCount - 1 ? `ae:ls:course:${page + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '↩️ Учёба', callback_data: 'ae:menu' }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderTeachersHorizontal(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const teachers = await listMentorPickerCandidates(admin, 'teacher');
  const from = page * TEACHERS_PER_PAGE;
  const slice = teachers.slice(from, from + TEACHERS_PER_PAGE);
  const keyboard: InlineButton[][] = slice.map((t) => [
    {
      text: shorten(t.full_name?.trim() || `ID ${t.telegram_id}`, 34),
      callback_data: `ae:ls:stu:${t.telegram_id}:0`,
    },
  ]);
  if (page > 0) {
    keyboard.push([{ text: '◀️', callback_data: `ae:ls:teachers:${page - 1}` }]);
  }
  if (from + slice.length < teachers.length) {
    keyboard.push([{ text: '▶️', callback_data: `ae:ls:teachers:${page + 1}` }]);
  }
  keyboard.push([{ text: '↩️ Учёба', callback_data: 'ae:menu' }], [homeButton()]);
  await editAdminMessage(
    message,
    '👨‍🏫 Преподаватели\n\nВыберите — откроется список его учеников.',
    { inline_keyboard: keyboard },
  );
}

async function startRescheduleStep(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  lessonId: number,
  nav: string,
): Promise<void> {
  const messageId = await sendAdminMessage(
    message.chatId,
    `🕐 Новая дата и время для занятия #${lessonId}\n\nФормат: дд.мм.гггг чч:мм (МСК) или ISO:`,
    homeOnlyKeyboard(),
  );
  if (!messageId) return;
  await saveState(
    admin,
    telegramId,
    { chatId: message.chatId, messageId },
    'edu:ls:datetime',
    { rescheduleLessonId: lessonId, scheduleNav: nav },
  );
}

export async function handleScheduleListAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  if (data === 'ae:ls:menu') {
    await renderScheduleWeekMenu(admin, deliver, 0, 0);
    return true;
  }

  if (data.startsWith('ae:ls:w:')) {
    const nav = parseNav(data.slice('ae:ls:w:'.length).split(':'));
    await renderScheduleWeekMenu(admin, deliver, nav.weekOffset, nav.teacherId);
    return true;
  }

  const tpMatch = data.match(/^ae:ls:tp:(-?\d+):(\d+)$/);
  if (tpMatch) {
    await renderTeacherPickerForSchedule(admin, message, Number(tpMatch[1]) || 0, Number(tpMatch[2]) || 0);
    return true;
  }

  const lessonMatch = data.match(/^ae:ls:l:(\d+):(-?\d+):(\d+)$/);
  if (lessonMatch) {
    const lesson = await getLesson(admin, Number(lessonMatch[1]));
    if (!lesson) {
      await deliver('Занятие не найдено.', { inline_keyboard: [[homeButton()]] });
      return true;
    }
    const nav = `${lessonMatch[2]}:${lessonMatch[3]}`;
    await renderLessonDetail(admin, message, lesson, nav);
    return true;
  }

  const rsMatch = data.match(/^ae:ls:rs:(\d+):(-?\d+):(\d+)$/);
  if (rsMatch) {
    await startRescheduleStep(
      admin,
      telegramId,
      message,
      Number(rsMatch[1]),
      `${rsMatch[2]}:${rsMatch[3]}`,
    );
    return true;
  }

  const cxMatch = data.match(/^ae:ls:cx:(\d+):(-?\d+):(\d+)$/);
  if (cxMatch) {
    const lessonId = Number(cxMatch[1]);
    const nav = `${cxMatch[2]}:${cxMatch[3]}`;
    const ok = await cancelScheduledLesson(admin, lessonId);
    if (ok) {
      await logAdminAction(admin, {
        actorTelegramId: telegramId,
        action: 'lesson.cancel',
        entityType: 'scheduled_lesson',
        entityId: lessonId,
      });
    }
    await deliver(ok ? `✅ Занятие #${lessonId} отменено.` : 'Не удалось отменить (уже не scheduled).', {
      inline_keyboard: [[{ text: '◀️ Расписание', callback_data: `ae:ls:w:${nav}` }], [homeButton()]],
    });
    return true;
  }

  const teachersMatch = data.match(/^ae:ls:teachers:(\d+)$/);
  if (teachersMatch) {
    await renderTeachersHorizontal(admin, message, Number(teachersMatch[1]) || 0);
    return true;
  }

  const stuMatch = data.match(/^ae:ls:stu:(\d+):(\d+)$/);
  if (stuMatch) {
    const { renderStudentFilterList } = await import('./student-catalog');
    await renderStudentFilterList(admin, message, 'all', Number(stuMatch[2]) || 0, Number(stuMatch[1]));
    return true;
  }

  const courseMatch = data.match(/^ae:ls:course:(\d+)$/);
  if (courseMatch) {
    await renderCourseStudentsHub(admin, message, Number(courseMatch[1]) || 0);
    return true;
  }

  return false;
}

export async function handleScheduleTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  if (state.step !== 'edu:ls:datetime') return false;

  const lessonId = state.payload.rescheduleLessonId;
  const nav = state.payload.scheduleNav ?? '0:0';
  if (!lessonId) {
    await clearState(admin, telegramId);
    return true;
  }

  const startsAt = parseScheduleDateTime(text.trim());
  if (!startsAt) {
    await sendAdminMessage(state.chat_id, 'Не удалось разобрать дату. Пример: 25.09.2026 18:30');
    return true;
  }

  const ok = await rescheduleLessonStartsAt(admin, lessonId, startsAt);
  if (ok) {
    await logAdminAction(admin, {
      actorTelegramId: telegramId,
      action: 'lesson.reschedule',
      entityType: 'scheduled_lesson',
      entityId: lessonId,
      detail: { starts_at: startsAt },
    });
  }
  await clearState(admin, telegramId);
  await sendAdminMessage(
    state.chat_id,
    ok
      ? `✅ Занятие #${lessonId} перенесено на ${formatDateTime(startsAt)}.`
      : 'Не удалось перенести (занятие не в статусе scheduled).',
    {
      inline_keyboard: [
        [{ text: 'Открыть занятие', callback_data: `ae:ls:l:${lessonId}:${nav}` }],
        [{ text: 'Расписание', callback_data: `ae:ls:w:${nav}` }],
        [homeButton()],
      ],
    },
  );
  return true;
}
