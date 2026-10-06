import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLessonHomework,
  homeworkReviewStatusLabel,
  resolveHomeworkAssignmentUrl,
  reviewLessonHomework,
  type LessonHomeworkReviewStatus,
  type LessonHomeworkSubmissionFile,
} from '@/lib/lesson-homework';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import { telegramSend } from '@/lib/telegram';
import { formatTelegramFileRef } from '@/lib/bot/studentHomeworkFlow';
import { studentDisplayName } from './teacher-data';

export type TeacherHomeworkQueueKind = 'pending' | 'revision' | 'done' | 'all';

export type TeacherHomeworkListItem = {
  homeworkId: number;
  lessonId: number;
  reviewStatus: LessonHomeworkReviewStatus;
  topic: string;
  startsAt: string;
  lessonKind: 'individual' | 'group';
  groupId: number | null;
  groupTitle: string | null;
  studentTelegramId: number | null;
  studentName: string | null;
  submittedAt: string | null;
};

export async function loadTeacherHomeworkItems(
  admin: SupabaseClient,
  teacherTelegramId: number,
): Promise<TeacherHomeworkListItem[]> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select(
      'id, lesson_id, review_status, submitted_at, scheduled_lessons!inner(topic, starts_at, teacher_telegram_id, telegram_id, kind, group_id)',
    )
    .eq('scheduled_lessons.teacher_telegram_id', teacherTelegramId)
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const studentIds = new Set<number>();
  const groupIds = new Set<number>();
  const rawRows: Array<{
    homeworkId: number;
    lessonId: number;
    reviewStatus: LessonHomeworkReviewStatus;
    topic: string;
    startsAt: string;
    lessonKind: 'individual' | 'group';
    groupId: number | null;
    studentTelegramId: number | null;
    submittedAt: string | null;
  }> = [];

  for (const row of data ?? []) {
    const lesson = row.scheduled_lessons as
      | {
          topic: string;
          starts_at: string;
          telegram_id: number | null;
          kind: 'individual' | 'group';
          group_id: number | null;
        }
      | {
          topic: string;
          starts_at: string;
          telegram_id: number | null;
          kind: 'individual' | 'group';
          group_id: number | null;
        }[]
      | null;
    const l = Array.isArray(lesson) ? lesson[0] : lesson;
    if (!l) continue;
    if (l.telegram_id) studentIds.add(l.telegram_id);
    if (l.group_id) groupIds.add(l.group_id);
    rawRows.push({
      homeworkId: row.id as number,
      lessonId: row.lesson_id as number,
      reviewStatus: row.review_status as LessonHomeworkReviewStatus,
      topic: l.topic,
      startsAt: l.starts_at,
      lessonKind: l.kind === 'group' ? 'group' : 'individual',
      groupId: l.group_id,
      studentTelegramId: l.telegram_id,
      submittedAt: (row.submitted_at as string | null) ?? null,
    });
  }

  const names = new Map<number, string>();
  if (studentIds.size > 0) {
    const { data: members } = await admin
      .from('bot_members')
      .select('telegram_id, full_name')
      .in('telegram_id', [...studentIds]);
    for (const m of members ?? []) {
      names.set(m.telegram_id as number, (m.full_name as string | null) ?? '');
    }
  }

  const groupTitles = new Map<number, string>();
  if (groupIds.size > 0) {
    const { data: groups } = await admin
      .from('groups')
      .select('id, title')
      .in('id', [...groupIds]);
    for (const g of groups ?? []) {
      groupTitles.set(g.id as number, (g.title as string) ?? '');
    }
  }

  return rawRows.map((r) => ({
    ...r,
    groupTitle: r.groupId ? groupTitles.get(r.groupId) ?? null : null,
    studentName: r.studentTelegramId ? names.get(r.studentTelegramId) || null : null,
  }));
}

export function filterHomeworkByQueue(
  items: TeacherHomeworkListItem[],
  queue: TeacherHomeworkQueueKind,
): TeacherHomeworkListItem[] {
  if (queue === 'pending') {
    return items.filter((i) => i.reviewStatus === 'submitted' || i.reviewStatus === 'reviewing');
  }
  if (queue === 'revision') {
    return items.filter((i) => i.reviewStatus === 'revision');
  }
  if (queue === 'all') {
    return [...items].sort(
      (a, b) =>
        (b.submittedAt ? Date.parse(b.submittedAt) : 0) -
        (a.submittedAt ? Date.parse(a.submittedAt) : 0),
    );
  }
  return items.filter((i) => i.reviewStatus === 'done').slice(0, 30);
}

export function homeworkLessonFormatLabel(item: TeacherHomeworkListItem): string {
  if (item.lessonKind === 'group') {
    return item.groupTitle ? `Группа «${item.groupTitle}»` : 'Групповое занятие';
  }
  return 'Индивидуальное';
}

export function homeworkListLabel(item: TeacherHomeworkListItem): string {
  const format = item.lessonKind === 'group' ? '👥' : '👤';
  const who =
    item.studentName?.trim() ||
    (item.studentTelegramId ? `ID ${item.studentTelegramId}` : item.groupTitle ?? '—');
  const groupHint =
    item.lessonKind === 'group' && item.groupTitle ? ` · ${item.groupTitle}` : '';
  return `${format} ${who}${groupHint} · ${item.topic}`.slice(0, 64);
}

export async function sendHomeworkSubmissionPreview(
  admin: SupabaseClient,
  staffChatId: number,
  lessonId: number,
): Promise<void> {
  const homework = await getLessonHomework(admin, lessonId);
  if (!homework) {
    await telegramSend('sendMessage', { chat_id: staffChatId, text: 'Работа не найдена.' });
    return;
  }

  if (homework.submissionText?.trim()) {
    await telegramSend('sendMessage', {
      chat_id: staffChatId,
      text: `📎 Ответ ученика:\n\n${homework.submissionText.trim()}`,
    });
  }

  for (const file of homework.submissionFiles) {
    await sendSubmissionFile(staffChatId, file);
  }

  const assignmentUrl = await resolveHomeworkAssignmentUrl(admin, homework.storagePath);
  if (assignmentUrl) {
    await telegramSend('sendMessage', {
      chat_id: staffChatId,
      text: `📄 Задание: ${homework.fileName}\n${assignmentUrl}`,
    });
  }
}

async function sendSubmissionFile(
  chatId: number,
  file: LessonHomeworkSubmissionFile,
): Promise<void> {
  if (file.ref.startsWith('tg:')) {
    const fileId = file.ref.slice(3);
    if (file.kind === 'photo') {
      await telegramSend('sendPhoto', { chat_id: chatId, photo: fileId });
    } else {
      await telegramSend('sendDocument', { chat_id: chatId, document: fileId });
    }
    return;
  }
  if (file.ref.startsWith('http')) {
    await telegramSend('sendMessage', { chat_id: chatId, text: `🔗 ${file.ref}` });
  }
}

export function renderHomeworkCardText(item: TeacherHomeworkListItem, homework: Awaited<ReturnType<typeof getLessonHomework>>): string {
  const lines = [
    '📝 Домашнее задание',
    '',
    `Формат: ${homeworkLessonFormatLabel(item)}`,
    `Занятие: ${item.topic}`,
    `Дата: ${formatLessonDateTimeRu(item.startsAt)}`,
    `Ученик (сдал): ${item.studentName ?? '—'}`,
    `Статус: ${homeworkReviewStatusLabel(item.reviewStatus)}`,
  ];
  if (homework?.submittedAt) {
    lines.push(`Сдано: ${formatLessonDateTimeRu(homework.submittedAt)}`);
  }
  if (homework?.teacherComment?.trim()) {
    lines.push('', `Комментарий: ${homework.teacherComment.trim()}`);
  }
  return lines.join('\n');
}

export async function approveTeacherHomework(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
): Promise<void> {
  await reviewLessonHomework(admin, teacherTelegramId, lessonId, { action: 'approve' });
}

export async function revisionTeacherHomework(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  comment: string,
): Promise<void> {
  await reviewLessonHomework(admin, teacherTelegramId, lessonId, {
    action: 'revision',
    comment,
  });
}

export { formatTelegramFileRef, homeworkReviewStatusLabel, studentDisplayName };
