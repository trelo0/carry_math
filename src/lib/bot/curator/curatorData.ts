import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  type CourseLessonContent,
} from '@/lib/studio/courseContent';
import type { CuratorHwItem, CuratorHwStatus } from './curator-types';
import {
  mapProgressToCuratorStatus,
  type CourseHomeworkLessonRef,
} from '../education/course-homework';
import type { CourseLessonStudentProgress } from '../education/course-progress';

export type CuratorHomeworkRecord = CuratorHwItem & {
  sanityLessonId: string;
  title: string;
  submissionFileUrl: string | null;
  submissionNote: string | null;
};

export type CuratorStudentRecord = {
  id: string;
  telegramId: number;
  name: string;
  homeworks: CuratorHomeworkRecord[];
};

const readNotificationsFallback = new Set<string>();

function isNotificationReadsTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('curator_notification_reads');
}

function mapToCuratorHwStatus(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  hasAccess: boolean,
): CuratorHwStatus {
  const status = mapProgressToCuratorStatus(lesson, progress, hasAccess);
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  if (status === 'rejected') return 'revision';
  if (status === 'pending') return 'waiting';
  return 'waiting';
}

async function studentDisplayName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from('student_profiles').select('display_name').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('bot_members').select('full_name').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  return (
    (profile?.display_name as string | undefined) ||
    (member?.full_name as string | undefined) ||
    `Ученик ${telegramId}`
  );
}

export async function listCuratorStudentTelegramIds(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<number[]> {
  const { data, error } = await admin
    .from('mentor_assignments')
    .select('telegram_id')
    .eq('mentor_telegram_id', curatorTelegramId)
    .eq('kind', 'curator')
    .eq('status', 'active');
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.telegram_id as number))];
}

export async function loadCuratorStudents(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<CuratorStudentRecord[]> {
  const content = await getDistrictCourseContent();
  if (!content) return [];

  const studentIds = await listCuratorStudentTelegramIds(admin, curatorTelegramId);
  if (studentIds.length === 0) return [];

  const lessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published' && (l.mandatoryHomework || l.homework))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
  const sanityIds = lessons.map((l) => l.sanityId);

  const [{ data: accessRows }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('telegram_id, sanity_lesson_id, access_status')
      .in('telegram_id', studentIds)
      .in('sanity_lesson_id', sanityIds),
    admin
      .from('course_lesson_student_progress')
      .select('*')
      .in('telegram_id', studentIds)
      .in('sanity_lesson_id', sanityIds),
  ]);

  const accessMap = new Map<string, string>();
  for (const row of accessRows ?? []) {
    accessMap.set(`${row.telegram_id}:${row.sanity_lesson_id}`, row.access_status as string);
  }
  const progressMap = new Map<string, CourseLessonStudentProgress>();
  for (const row of progressRows ?? []) {
    progressMap.set(`${row.telegram_id}:${row.sanity_lesson_id}`, row as CourseLessonStudentProgress);
  }

  const out: CuratorStudentRecord[] = [];
  for (const telegramId of studentIds) {
    const homeworks: CuratorHomeworkRecord[] = lessons
      .map((lesson) => {
        const key = `${telegramId}:${lesson.sanityId}`;
        const access = accessMap.get(key);
        const hasAccess = access === 'available' || access === 'blocked_lives';
        if (!hasAccess) return null;
        const progress = progressMap.get(key);
        return {
          number: lesson.lessonNumber,
          status: mapToCuratorHwStatus(lesson, progress, true),
          sanityLessonId: lesson.sanityId,
          title: lesson.title,
          submissionFileUrl: progress?.submission_file_url ?? null,
          submissionNote: progress?.submission_note ?? null,
        };
      })
      .filter((item): item is CuratorHomeworkRecord => item != null);

    out.push({
      id: String(telegramId),
      telegramId,
      name: await studentDisplayName(admin, telegramId),
      homeworks,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function getCuratorStudentRecord(
  students: CuratorStudentRecord[],
  studentId: string,
): CuratorStudentRecord | undefined {
  return students.find((s) => s.id === studentId);
}

export function getCuratorHomeworkRecord(
  student: CuratorStudentRecord,
  hwNumber: number,
): CuratorHomeworkRecord | undefined {
  return student.homeworks.find((hw) => hw.number === hwNumber);
}

export type CuratorStudentLevel = 'ok' | 'review' | 'debt';

export type CuratorStudentSummary = {
  level: CuratorStudentLevel;
  emoji: string;
  debtCount: number;
  debtNumbers: number[];
  reviewCount: number;
  revisionCount: number;
};

function debtLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} долг`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} долга`;
  return `${count} долгов`;
}

export function summarizeCuratorStudent(student: CuratorStudentRecord): CuratorStudentSummary {
  const debtNumbers = student.homeworks.filter((hw) => hw.status === 'waiting').map((hw) => hw.number);
  const reviewCount = student.homeworks.filter((hw) => hw.status === 'submitted').length;
  const revisionCount = student.homeworks.filter((hw) => hw.status === 'revision').length;
  const level: CuratorStudentLevel = debtNumbers.length > 0 ? 'debt' : reviewCount > 0 ? 'review' : 'ok';
  const emoji = level === 'debt' ? '🔴' : level === 'review' ? '🟡' : '🟢';
  return { level, emoji, debtCount: debtNumbers.length, debtNumbers, reviewCount, revisionCount };
}

export function listCuratorStudentLabel(student: CuratorStudentRecord): string {
  const summary = summarizeCuratorStudent(student);
  if (summary.level === 'debt') return `${summary.emoji} ${student.name} — ${debtLabel(summary.debtCount)}`;
  if (summary.level === 'review') return `${summary.emoji} ${student.name} — ${summary.reviewCount} ДЗ на проверке`;
  return `${summary.emoji} ${student.name}`;
}

export function summarizeCuratorStudents(students: CuratorStudentRecord[]): {
  notSubmitted: number;
  awaitingReview: number;
  revision: number;
} {
  let notSubmitted = 0;
  let awaitingReview = 0;
  let revision = 0;
  for (const student of students) {
    notSubmitted += student.homeworks.filter((hw) => hw.status === 'waiting').length;
    awaitingReview += student.homeworks.filter((hw) => hw.status === 'submitted').length;
    revision += student.homeworks.filter((hw) => hw.status === 'revision').length;
  }
  return { notSubmitted, awaitingReview, revision };
}

export type CuratorSubmissionNotification = {
  id: string;
  studentId: string;
  studentName: string;
  hwNumber: number;
  sanityLessonId: string;
};

export function listCuratorSubmissionNotifications(
  students: CuratorStudentRecord[],
): CuratorSubmissionNotification[] {
  return students.flatMap((student) =>
    student.homeworks
      .filter((hw) => hw.status === 'submitted')
      .map((hw) => ({
        id: `${student.id}:${hw.number}`,
        studentId: student.id,
        studentName: student.name,
        hwNumber: hw.number,
        sanityLessonId: hw.sanityLessonId,
      })),
  );
}

export async function isCuratorNotificationRead(
  admin: SupabaseClient,
  curatorTelegramId: number,
  notificationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('curator_notification_reads')
      .select('notification_id')
      .eq('curator_telegram_id', curatorTelegramId)
      .eq('notification_id', notificationId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } catch (error) {
    if (!isNotificationReadsTableError(error)) throw error;
    return readNotificationsFallback.has(notificationId);
  }
}

export async function markCuratorNotificationRead(
  admin: SupabaseClient,
  curatorTelegramId: number,
  notificationId: string,
): Promise<void> {
  try {
    await admin.from('curator_notification_reads').upsert(
      {
        curator_telegram_id: curatorTelegramId,
        notification_id: notificationId,
        read_at: new Date().toISOString(),
      },
      { onConflict: 'curator_telegram_id,notification_id' },
    );
  } catch (error) {
    if (!isNotificationReadsTableError(error)) throw error;
    readNotificationsFallback.add(notificationId);
  }
}

export function getCuratorNotificationById(
  students: CuratorStudentRecord[],
  notificationId: string,
): CuratorSubmissionNotification | undefined {
  return listCuratorSubmissionNotifications(students).find((n) => n.id === notificationId);
}

export function toHomeworkLessonRef(record: CuratorHomeworkRecord): CourseHomeworkLessonRef {
  return {
    sanityLessonId: record.sanityLessonId,
    lessonNumber: record.number,
    title: record.title,
  };
}
