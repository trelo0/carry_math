import type { SupabaseClient } from '@supabase/supabase-js';
import { getCuratorCabinetData } from '@/lib/curator/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import {
  loadCuratorStudents,
  summarizeCuratorStudents,
  type CuratorStudentRecord,
} from '@/lib/bot/curator/curatorData';
import { listCuratorThreads } from './messaging';
import { loadCuratorCourseStudents } from '@/lib/curator/students';
import { buildCuratorAttentionItems, type CuratorAttentionItem } from './curator-attention';

/** Порог «мало жизней» для Arena (v1). */
export const CURATOR_LOW_LIVES_THRESHOLD = 2;

/** Дней без сдачи/завершения урока для «низкой активности» (v1). */
export const CURATOR_LOW_ACTIVITY_DAYS = 14;

export type CuratorLowLivesEntry = {
  student: CuratorStudentRecord;
  livesCurrent: number;
  livesMax: number | null;
};

export type CuratorActivitySnapshot = {
  courseId: number | null;
  awaitingReview: number;
  newQuestions: number;
  attentionCount: number;
  courseStudentCount: number;
  liveLine: string;
  nextLine: string;
  lastLine: string;
  /** Sanity id следующего урока курса (для назначения даты). */
  nextSanityId: string | null;
  lowLives: CuratorLowLivesEntry[];
  lowActivityStudents: CuratorStudentRecord[];
  attentionItems: CuratorAttentionItem[];
  frozenCount: number;
  overdueCount: number;
};

async function listLowLivesStudents(
  admin: SupabaseClient,
  students: CuratorStudentRecord[],
  courseId: number | null,
): Promise<CuratorLowLivesEntry[]> {
  if (!courseId) return [];

  const out: CuratorLowLivesEntry[] = [];
  for (const student of students) {
    try {
      const lives = await getEnrollmentLives(admin, student.telegramId, courseId);
      const current = lives?.lives_current;
      if (typeof current !== 'number') continue;
      if (current <= CURATOR_LOW_LIVES_THRESHOLD) {
        out.push({
          student,
          livesCurrent: current,
          livesMax: lives?.lives_max ?? null,
        });
      }
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }
  }
  out.sort((a, b) => a.livesCurrent - b.livesCurrent || a.student.name.localeCompare(b.student.name, 'ru'));
  return out;
}

async function listLowActivityStudents(
  admin: SupabaseClient,
  students: CuratorStudentRecord[],
  courseId: number | null,
): Promise<CuratorStudentRecord[]> {
  if (!courseId || students.length === 0) return [];

  const ids = students.map((s) => s.telegramId);
  const cutoff = Date.now() - CURATOR_LOW_ACTIVITY_DAYS * 86400000;

  const [{ data: enrollments }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_enrollments')
      .select('telegram_id, started_at')
      .eq('course_id', courseId)
      .in('telegram_id', ids),
    admin
      .from('course_lesson_student_progress')
      .select('telegram_id, completed_at, homework_submitted_at, updated_at')
      .eq('course_id', courseId)
      .in('telegram_id', ids),
  ]);

  const enrolledAt = new Map<number, number>();
  for (const row of enrollments ?? []) {
    const ts = Date.parse(String(row.started_at ?? ''));
    if (Number.isFinite(ts)) enrolledAt.set(row.telegram_id as number, ts);
  }

  const lastTouch = new Map<number, number>();
  for (const row of progressRows ?? []) {
    const id = row.telegram_id as number;
    for (const field of [row.completed_at, row.homework_submitted_at, row.updated_at]) {
      const ts = Date.parse(String(field ?? ''));
      if (!Number.isFinite(ts)) continue;
      lastTouch.set(id, Math.max(lastTouch.get(id) ?? 0, ts));
    }
  }

  const out: CuratorStudentRecord[] = [];
  for (const student of students) {
    const start = enrolledAt.get(student.telegramId);
    if (!start || start > cutoff) continue;
    const touch = lastTouch.get(student.telegramId) ?? start;
    if (touch >= cutoff) continue;
    const hasApproved = student.homeworks.some((hw) => hw.status === 'approved');
    const hasSubmitted = student.homeworks.some((hw) => hw.status === 'submitted' || hw.status === 'revision');
    if (hasApproved || hasSubmitted) continue;
    out.push(student);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function formatLiveLine(liveCount: number, titles: string[]): string {
  if (liveCount === 0) return '🔴 Сейчас в эфире: нет';
  if (titles.length === 0) return `🔴 Сейчас в эфире: ${liveCount}`;
  return `🔴 Сейчас в эфире: ${titles.join('; ')}`;
}

function formatNextLine(nextTitle: string | null, nextAt: string | null): string {
  if (!nextTitle) return '⏭ Следующее занятие: не запланировано';
  const when = nextAt ? formatLessonDateTimeRu(nextAt) : 'дата уточняется';
  return `⏭ Следующее: ${nextTitle} · ${when}`;
}

function formatLastLine(lastTitle: string | null, lastAt: string | null): string {
  if (!lastTitle) return '⏮ Прошлое занятие: нет';
  const when = lastAt ? formatLessonDateTimeRu(lastAt) : 'дата уточняется';
  return `⏮ Прошлое: ${lastTitle} · ${when}`;
}

async function listPaymentWarnings(
  admin: SupabaseClient,
  students: CuratorStudentRecord[],
): Promise<Array<{ student: CuratorStudentRecord; expiresAt: string }>> {
  const ids = students.map((s) => s.telegramId);
  if (ids.length === 0) return [];
  const soon = Date.now() + 7 * 86400000;
  const { data, error } = await admin
    .from('user_accesses')
    .select('telegram_id, expires_at')
    .eq('product', 'course')
    .eq('status', 'active')
    .in('telegram_id', ids)
    .not('expires_at', 'is', null);
  if (error) return [];
  const byId = new Map(students.map((s) => [s.telegramId, s]));
  const out: Array<{ student: CuratorStudentRecord; expiresAt: string }> = [];
  for (const row of data ?? []) {
    const exp = String(row.expires_at ?? '');
    const ts = Date.parse(exp);
    if (!Number.isFinite(ts) || ts > soon) continue;
    const student = byId.get(row.telegram_id as number);
    if (student) out.push({ student, expiresAt: exp });
  }
  return out;
}

export async function loadCuratorActivitySnapshot(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<CuratorActivitySnapshot> {
  const [{ students: courseViews }, students, { threads }, cabinet] = await Promise.all([
    loadCuratorCourseStudents(admin, curatorTelegramId),
    loadCuratorStudents(admin, curatorTelegramId),
    listCuratorThreads(admin, curatorTelegramId),
    getCuratorCabinetData(admin, curatorTelegramId, null),
  ]);

  const courseId = cabinet.courseId ?? null;
  const hw = summarizeCuratorStudents(students);
  const newQuestions = threads.filter((t) => t.unreadCount > 0).length;
  const lowLives = await listLowLivesStudents(admin, students, courseId);
  const lowActivityStudents = await listLowActivityStudents(admin, students, courseId);
  const accessBlockedStudents = courseViews.filter((s) => s.accessBlocked && !s.fullyBlocked);
  const frozenStudents = courseViews.filter(
    (s) => s.accessBlocked && (s.livesCurrent ?? 0) <= 0 && !s.fullyBlocked,
  );
  const fullyBlockedStudents = courseViews.filter((s) => s.fullyBlocked);
  const overdueStudents = courseViews
    .filter((s) => s.overdueHomeworkCount > 0)
    .map((s) => ({ student: s, count: s.overdueHomeworkCount }));
  const staleReviewStudents = courseViews
    .filter((s) => s.staleReviewDays >= 2)
    .map((s) => ({ student: s, days: s.staleReviewDays }));
  const stuckStudents = courseViews
    .filter((s) => s.stuckLessonLabel)
    .map((s) => ({ student: s, lessonLabel: s.stuckLessonLabel as string }));
  const revisionIdleStudents = courseViews.filter((s) => s.revisionIdle);
  const paymentWarnings = await listPaymentWarnings(admin, students);
  const attentionItems = buildCuratorAttentionItems({
    lowLives,
    frozenStudents,
    fullyBlockedStudents,
    overdueStudents,
    lowActivityStudents,
    accessBlockedStudents,
    paymentWarnings,
    staleReviewStudents,
    stuckStudents,
    revisionIdleStudents,
  });

  const liveTitles = cabinet.dashboard.liveLessons.map((l) => `Урок ${l.lessonNumber}`);
  const next = cabinet.dashboard.nextLesson;
  const last = cabinet.dashboard.lastLesson;
  const lastAt = last?.endedAt ?? last?.scheduledAt ?? null;

  return {
    courseId,
    awaitingReview: hw.awaitingReview,
    newQuestions,
    attentionCount: attentionItems.length,
    courseStudentCount: courseViews.length,
    liveLine: formatLiveLine(cabinet.dashboard.liveNow, liveTitles),
    nextLine: formatNextLine(next?.title ?? null, next?.scheduledAt ?? null),
    lastLine: formatLastLine(last?.title ?? null, lastAt),
    nextSanityId: next?.sanityId ?? null,
    lowLives,
    lowActivityStudents,
    attentionItems,
    frozenCount: frozenStudents.length,
    overdueCount: overdueStudents.length,
  };
}
