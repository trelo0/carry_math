import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudentTeacher } from '@/lib/bot/education/assignments';
import {
  getHomeworkById,
  homeworkReviewStatusLabel,
  listHomeworkSubmissionVersions,
  resolveHomeworkAssignmentUrl,
  reviewHomeworkAsStaff,
  type LessonHomeworkReviewStatus,
} from '@/lib/lesson-homework';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  getState,
  homeButton,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import { getMember } from '@/lib/bot/roles';
import { staffStudentLabel } from '@/lib/bot/staff/messaging';

const PER_PAGE = 6;
const MSK_OFFSET = 3 * 3600000;
const MS_DAY = 86400000;
const LONG_PENDING_MS = 3 * MS_DAY;

export type AdminHwQueue = 'pending' | 'revision' | 'all' | 'long';

function mskTodayStartIso(): string {
  const mskMidnight = Math.floor((Date.now() + MSK_OFFSET) / MS_DAY) * MS_DAY - MSK_OFFSET;
  return new Date(mskMidnight).toISOString();
}

function formatHwWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function queueStatuses(queue: AdminHwQueue): LessonHomeworkReviewStatus[] | null {
  if (queue === 'pending' || queue === 'long') return ['submitted', 'reviewing'];
  if (queue === 'revision') return ['revision'];
  return null;
}

export async function countAdminHomeworkQueues(admin: SupabaseClient): Promise<{
  pending: number;
  revision: number;
  doneToday: number;
}> {
  const todayFrom = mskTodayStartIso();
  const [pending, revision, doneToday] = await Promise.all([
    admin
      .from('homework_assignments')
      .select('id', { count: 'exact', head: true })
      .in('review_status', ['submitted', 'reviewing']),
    admin
      .from('homework_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'revision'),
    admin
      .from('homework_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'done')
      .gte('updated_at', todayFrom),
  ]);
  return {
    pending: pending.count ?? 0,
    revision: revision.count ?? 0,
    doneToday: doneToday.count ?? 0,
  };
}

type AdminHwListItem = {
  homeworkId: number;
  lessonId: number;
  reviewStatus: LessonHomeworkReviewStatus;
  studentTelegramId: number | null;
  studentLabel: string;
  topic: string;
  courseLabel: string;
  teacherLabel: string;
  submittedAt: string | null;
  fileCount: number;
};

async function resolveTeacherLabel(
  admin: SupabaseClient,
  lessonTeacherId: number | null,
  studentId: number | null,
): Promise<string> {
  const labelForId = async (id: number) => {
    const member = await getMember(admin, id);
    return member ? memberDisplayName(member) : `ID ${id}`;
  };
  if (lessonTeacherId) return labelForId(lessonTeacherId);
  if (studentId) {
    const t = await getStudentTeacher(admin, studentId, { assignmentsOnly: true });
    if (t?.fullName?.trim()) return t.fullName.trim();
    if (t?.telegramId) return labelForId(t.telegramId);
  }
  return '—';
}

async function listAdminHomework(
  admin: SupabaseClient,
  queue: AdminHwQueue,
  page: number,
): Promise<{ items: AdminHwListItem[]; total: number }> {
  const statuses = queueStatuses(queue);
  let query = admin
    .from('homework_assignments')
    .select(
      'id, lesson_id, review_status, submitted_at, submission_files, scheduled_lessons(topic, telegram_id, teacher_telegram_id, kind, group_id)',
      { count: 'exact' },
    )
    .order('submitted_at', { ascending: false, nullsFirst: false });

  if (statuses) query = query.in('review_status', statuses);
  if (queue === 'long') {
    query = query.lt('submitted_at', new Date(Date.now() - LONG_PENDING_MS).toISOString());
  }

  const from = page * PER_PAGE;
  const { data, error, count } = await query.range(from, from + PER_PAGE - 1);
  if (error) throw error;

  const items: AdminHwListItem[] = [];
  for (const row of data ?? []) {
    const lessonRaw = row.scheduled_lessons as
      | {
          topic: string;
          telegram_id: number | null;
          teacher_telegram_id: number | null;
          kind: string;
          group_id: number | null;
        }
      | {
          topic: string;
          telegram_id: number | null;
          teacher_telegram_id: number | null;
          kind: string;
          group_id: number | null;
        }[]
      | null;
    const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
    const studentId = lesson?.telegram_id ?? null;
    const studentLabel = studentId ? await staffStudentLabel(admin, studentId) : '—';
    const teacherLabel = await resolveTeacherLabel(admin, lesson?.teacher_telegram_id ?? null, studentId);
    const files = row.submission_files;
    const fileCount = Array.isArray(files) ? files.length : 0;
    const courseLabel = lesson?.kind === 'group' ? 'Группа' : 'Занятие';
    items.push({
      homeworkId: row.id as number,
      lessonId: row.lesson_id as number,
      reviewStatus: row.review_status as LessonHomeworkReviewStatus,
      studentTelegramId: studentId,
      studentLabel,
      topic: lesson?.topic ?? '—',
      courseLabel,
      teacherLabel,
      submittedAt: (row.submitted_at as string | null) ?? null,
      fileCount,
    });
  }
  return { items, total: count ?? 0 };
}

function queueTitle(queue: AdminHwQueue): string {
  if (queue === 'pending') return '🔴 Требуют проверки';
  if (queue === 'revision') return '🟡 На доработке';
  if (queue === 'long') return '⏳ На проверке >3 дней';
  return '📋 Все';
}

export async function renderAdminHomeworkHub(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const { pending, revision, doneToday } = await countAdminHomeworkQueues(admin);
  const text = [
    '📝 Домашние задания',
    '',
    `🔴 Требуют проверки — ${pending}`,
    `🟡 На доработке — ${revision}`,
    `🟢 Проверены сегодня — ${doneToday}`,
  ].join('\n');
  await deliver(text, {
    inline_keyboard: [
      [{ text: '🔴 Требуют проверки', callback_data: 'ae:hw:q:pending:0' }],
      [{ text: '⏳ >3 дней', callback_data: 'ae:hw:q:long:0' }],
      [{ text: '🟡 На доработке', callback_data: 'ae:hw:q:revision:0' }],
      [{ text: '📋 Все', callback_data: 'ae:hw:q:all:0' }],
      [{ text: '🔎 Найти', callback_data: 'ae:hw:search' }],
      [{ text: '⬅️ Обучение', callback_data: 'ae:menu' }],
      [homeButton()],
    ],
  });
}

export async function renderAdminHomeworkQueue(
  admin: SupabaseClient,
  message: AdminMessage,
  queue: AdminHwQueue,
  page: number,
): Promise<void> {
  const { items, total } = await listAdminHomework(admin, queue, page);
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);

  const lines =
    items.length === 0
      ? `${queueTitle(queue)}\n\nОчередь пуста.`
      : [
          queueTitle(queue),
          '',
          ...items.map((item) =>
            [
              `👨‍🎓 ${item.studentLabel}`,
              `📚 ${item.courseLabel} · ${shorten(item.topic, 40)}`,
              `👨‍🏫 ${item.teacherLabel}`,
              item.fileCount > 0 ? `📎 ${item.fileCount} файл(ов)` : '',
              formatHwWhen(item.submittedAt),
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        ].join('\n\n');

  const keyboard: InlineButton[][] = items.map((item) => [
    {
      text: `${shorten(item.studentLabel, 20)} · ${shorten(item.topic, 18)}`,
      callback_data: `ae:hw:v:${item.homeworkId}:${queue}:${safePage}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ae:hw:q:${queue}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ae:hw:q:${queue}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push(
    [{ text: '⬅️ Домашние задания', callback_data: 'ae:hw:hub' }],
    [{ text: '⬅️ Обучение', callback_data: 'ae:menu' }],
    [homeButton()],
  );

  await editAdminMessage(message, lines, { inline_keyboard: keyboard });
}

async function sendHomeworkFilesToChat(
  admin: SupabaseClient,
  chatId: number,
  homeworkId: number,
): Promise<void> {
  const hw = await getHomeworkById(admin, homeworkId);
  if (!hw) return;
  for (const file of hw.submissionFiles) {
    const ref = file.ref;
    if (ref.startsWith('tg:')) {
      const fileId = ref.slice(3);
      if (file.kind === 'photo') {
        await telegramSend('sendPhoto', { chat_id: chatId, photo: fileId }).catch(() => undefined);
      } else {
        await telegramSend('sendDocument', { chat_id: chatId, document: fileId }).catch(() => undefined);
      }
    }
  }
  const assignmentUrl = await resolveHomeworkAssignmentUrl(admin, hw.storagePath);
  if (assignmentUrl) {
    await sendAdminMessage(chatId, `📄 Задание: ${hw.fileName}\n${assignmentUrl}`);
  }
}

export async function renderAdminHomeworkDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  homeworkId: number,
  queue: AdminHwQueue,
  page: number,
): Promise<void> {
  const hw = await getHomeworkById(admin, homeworkId);
  if (!hw) {
    await editAdminMessage(message, 'ДЗ не найдено.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `ae:hw:q:${queue}:${page}` }], [homeButton()]],
    });
    return;
  }

  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('topic, starts_at, telegram_id, teacher_telegram_id, kind')
    .eq('id', hw.lessonId)
    .maybeSingle();

  const studentId = (lesson?.telegram_id as number | null) ?? null;
  const studentLabel = studentId ? await staffStudentLabel(admin, studentId) : '—';
  const teacherLabel = await resolveTeacherLabel(
    admin,
    (lesson?.teacher_telegram_id as number | null) ?? null,
    studentId,
  );

  const lessonTitle = lesson?.topic ? String(lesson.topic) : '—';
  const courseLine = lesson?.kind === 'group' ? 'Групповое занятие' : 'Математика';

  const statusLine =
    hw.reviewStatus === 'submitted' || hw.reviewStatus === 'reviewing'
      ? '🔴 Требует проверки'
      : hw.reviewStatus === 'revision'
        ? '🟡 На доработке'
        : `🟢 ${homeworkReviewStatusLabel(hw.reviewStatus)}`;

  const fileNames =
    hw.submissionFiles.length > 0
      ? hw.submissionFiles.map((f) => f.name ?? 'файл').join(', ')
      : hw.fileName;

  const versions = await listHomeworkSubmissionVersions(admin, homeworkId);
  let historyBlock = '';
  if (versions.length > 0) {
    const lines = versions.map((v, i) => {
      const emoji =
        v.outcome === 'approved' ? '🟢' : v.outcome === 'revision' ? '🔄' : '🔴';
      const label =
        v.outcome === 'approved'
          ? 'Проверено'
          : v.outcome === 'revision'
            ? 'На доработку'
            : 'Новая версия';
      return `${i + 1}️⃣ ${emoji} ${label}`;
    });
    historyBlock = ['', 'История:', ...lines].join('\n');
  }

  const lines = [
    '📝 Домашнее задание',
    '',
    '👨‍🎓 Ученик',
    studentLabel,
    '',
    '👨‍🏫 Преподаватель',
    teacherLabel,
    '',
    '📚 Курс',
    courseLine,
    '',
    '📖 Урок',
    lessonTitle,
    '',
    '📅 Отправлено',
    formatHwWhen(hw.submittedAt),
    '',
    statusLine,
    '',
    '📎 Работа ученика',
    fileNames,
    '',
    hw.submissionText?.trim() ? '💬 Комментарий ученика' : '',
    hw.submissionText?.trim() ? `«${shorten(hw.submissionText.trim(), 500)}»` : '',
    historyBlock,
  ].filter((line) => line !== '');

  const canReview = hw.reviewStatus === 'submitted' || hw.reviewStatus === 'reviewing';
  const keyboard: InlineButton[][] = [
    [{ text: '👁 Открыть работу', callback_data: `ae:hw:open:${homeworkId}:${queue}:${page}` }],
  ];
  if (canReview) {
    keyboard.push(
      [{ text: '✅ Принять', callback_data: `ae:hw:ok:${homeworkId}:${queue}:${page}` }],
      [{ text: '🔄 На доработку', callback_data: `ae:hw:rev:${homeworkId}:${queue}:${page}` }],
    );
  }
  keyboard.push([{ text: '⬅️ Назад', callback_data: `ae:hw:q:${queue}:${page}` }], [homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function handleAdminHomeworkAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'ae:hw:hub') {
    await renderAdminHomeworkHub(admin, editDeliver(message));
    return true;
  }

  const queueMatch = data.match(/^ae:hw:q:(pending|revision|all|long):(\d+)$/);
  if (queueMatch) {
    await renderAdminHomeworkQueue(
      admin,
      message,
      queueMatch[1] as AdminHwQueue,
      Number(queueMatch[2]) || 0,
    );
    return true;
  }

  const viewMatch = data.match(/^ae:hw:v:(\d+):(pending|revision|all|long):(\d+)$/);
  if (viewMatch) {
    await renderAdminHomeworkDetail(
      admin,
      message,
      Number(viewMatch[1]),
      viewMatch[2] as AdminHwQueue,
      Number(viewMatch[3]) || 0,
    );
    return true;
  }

  const openMatch = data.match(/^ae:hw:open:(\d+):(pending|revision|all|long):(\d+)$/);
  if (openMatch) {
    const hwId = Number(openMatch[1]);
    await sendHomeworkFilesToChat(admin, message.chatId, hwId);
    await renderAdminHomeworkDetail(
      admin,
      message,
      hwId,
      openMatch[2] as AdminHwQueue,
      Number(openMatch[3]) || 0,
    );
    return true;
  }

  const okMatch = data.match(/^ae:hw:ok:(\d+):(pending|revision|all|long):(\d+)$/);
  if (okMatch) {
    const hwId = Number(okMatch[1]);
    try {
      await reviewHomeworkAsStaff(admin, hwId, telegramId, 'admin', { action: 'approve' });
      await editAdminMessage(message, '✅ Домашнее задание принято.', {
        inline_keyboard: [
          [{ text: '⬅️ Очередь', callback_data: `ae:hw:q:${okMatch[2]}:${okMatch[3]}` }],
          [{ text: '📝 Домашние задания', callback_data: 'ae:hw:hub' }],
          [homeButton()],
        ],
      });
    } catch (error) {
      await editAdminMessage(message, error instanceof Error ? error.message : 'Ошибка проверки.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `ae:hw:v:${hwId}:${okMatch[2]}:${okMatch[3]}` }]],
      });
    }
    return true;
  }

  const revMatch = data.match(/^ae:hw:rev:(\d+):(pending|revision|all|long):(\d+)$/);
  if (revMatch) {
    const hwId = Number(revMatch[1]);
    await saveState(admin, telegramId, message, 'admin:hw:revision', {
      adminHwId: hwId,
      adminHwQueue: revMatch[2],
      adminHwPage: Number(revMatch[3]) || 0,
    });
    await editAdminMessage(message, '🔄 На доработку\n\nНапишите комментарий для ученика (обязательно):', {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: `ae:hw:v:${hwId}:${revMatch[2]}:${revMatch[3]}` }],
        [{ text: '❌ Отмена', callback_data: 'ae:hw:hub' }],
      ],
    });
    return true;
  }

  if (data === 'ae:hw:search') {
    await saveState(admin, telegramId, message, 'admin:hw:search', {});
    await editAdminMessage(message, '🔎 Поиск ДЗ\n\nВведите имя ученика или тему урока:', {
      inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'ae:hw:hub' }], [homeButton()]],
    });
    return true;
  }

  return false;
}

export async function handleAdminHomeworkTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const input = text.trim();
  if (state.step === 'admin:hw:revision') {
    const payload = state.payload ?? {};
    const hwId = payload.adminHwId as number | undefined;
    const queue = (payload.adminHwQueue as AdminHwQueue) ?? 'pending';
    const page = Number(payload.adminHwPage) || 0;
    if (!hwId || !input) {
      await sendAdminMessage(state.chat_id, '⚠️ Нужен комментарий для доработки.');
      return true;
    }
    try {
      await reviewHomeworkAsStaff(admin, hwId, telegramId, 'admin', {
        action: 'revision',
        comment: input,
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(state.chat_id, '✅ Отправлено на доработку. Ученик получит уведомление.', {
        inline_keyboard: [
          [{ text: '⬅️ Очередь', callback_data: `ae:hw:q:${queue}:${page}` }],
          [{ text: '📝 Домашние задания', callback_data: 'ae:hw:hub' }],
        ],
      });
    } catch (error) {
      await sendAdminMessage(
        state.chat_id,
        error instanceof Error ? error.message : 'Не удалось сохранить.',
      );
    }
    return true;
  }

  if (state.step === 'admin:hw:search') {
    if (!input) return true;
    const { data, error } = await admin
      .from('homework_assignments')
      .select('id, lesson_id, scheduled_lessons(topic, telegram_id)')
      .limit(20);
    if (error) throw error;
    const q = input.toLowerCase();
    const matches: number[] = [];
    for (const row of data ?? []) {
      const lessonRaw = row.scheduled_lessons as
        | { topic: string; telegram_id: number | null }
        | { topic: string; telegram_id: number | null }[]
        | null;
      const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
      const topic = lesson?.topic?.toLowerCase() ?? '';
      let name = '';
      if (lesson?.telegram_id) name = (await staffStudentLabel(admin, lesson.telegram_id)).toLowerCase();
      if (topic.includes(q) || name.includes(q)) matches.push(row.id as number);
    }
    const message = { chatId: state.chat_id, messageId: state.message_id };
    if (matches.length === 0) {
      await editAdminMessage(message, 'Ничего не найдено.', {
        inline_keyboard: [[{ text: '⬅️ Домашние задания', callback_data: 'ae:hw:hub' }], [homeButton()]],
      });
      await clearStateIfAvailable(admin, telegramId);
      return true;
    }
    const keyboard: InlineButton[][] = matches.slice(0, 8).map((id) => [
      { text: `#${id}`, callback_data: `ae:hw:v:${id}:all:0` },
    ]);
    keyboard.push([{ text: '⬅️ Домашние задания', callback_data: 'ae:hw:hub' }], [homeButton()]);
    await editAdminMessage(message, `Найдено: ${matches.length}`, { inline_keyboard: keyboard });
    await clearStateIfAvailable(admin, telegramId);
    return true;
  }

  return false;
}

export function isAdminHomeworkAction(data: string): boolean {
  return data.startsWith('ae:hw:');
}

/** Легаси-кнопки ah:hw:* → ae:hw:* */
export function translateLegacyAdminHomeworkCallback(data: string): string | null {
  if (data === 'ah:hw:menu' || data === 'ah:hw:pending') return 'ae:hw:hub';
  const q = data.match(/^ah:hw:q:(all|long):(\d+)$/);
  if (q) return `ae:hw:q:${q[1] === 'long' ? 'long' : 'pending'}:${q[2]}`;
  const d = data.match(/^ah:hw:d:(\d+):(all|long):(\d+)$/);
  if (d) return `ae:hw:v:${d[1]}:${d[2] === 'long' ? 'long' : 'pending'}:${d[3]}`;
  return null;
}
