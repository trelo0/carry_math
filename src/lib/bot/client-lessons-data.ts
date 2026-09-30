import type { SupabaseClient } from '@supabase/supabase-js';
import { homeworkReviewStatusLabel, type LessonHomeworkReviewStatus } from '@/lib/lesson-homework';
import { formatLessonDateTime } from '@/lib/teacher/format';

export type ClientLessonKind = 'individual' | 'group';
export type ClientLessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export type ClientLessonSummary = {
  id: number;
  topic: string;
  startsAt: string;
  kind: ClientLessonKind;
  status: ClientLessonStatus;
  isPaid: boolean | null;
  meetUrl: string | null;
  teacherName: string | null;
};

export type ClientHomeworkView = {
  id: number;
  fileName: string;
  reviewStatus: string;
};

export type ClientLessonDetail = ClientLessonSummary & {
  durationMinutes: number;
  lessonPlan: string | null;
  materialsCount: number;
  homework: ClientHomeworkView | null;
};

const LESSON_SELECT =
  'id, topic, starts_at, kind, status, meet_url, is_paid, teacher_telegram_id, duration_minutes, lesson_plan';

function kindLabel(kind: ClientLessonKind): string {
  return kind === 'individual' ? 'Индивидуальное' : 'Групповое';
}

export function formatClientPaymentStatus(isPaid: boolean | null): string {
  if (isPaid === true) return 'Оплачено';
  if (isPaid === false) return 'Ожидает оплаты';
  return 'Требует уточнения';
}

export function formatClientLessonLine(summary: ClientLessonSummary): string {
  const { date, time } = formatLessonDateTime(summary.startsAt);
  return `${date}, ${time} — ${summary.topic}`;
}

export function formatScheduleDayHeader(iso: string): string {
  const label = new Date(iso).toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Minsk',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function loadTeacherNames(
  admin: SupabaseClient,
  ids: number[],
): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id, full_name')
    .in('telegram_id', unique);
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      row.telegram_id as number,
      (row.full_name as string | null)?.trim() || `Преподаватель`,
    ]),
  );
}

function mapLessonRow(
  row: Record<string, unknown>,
  teachers: Map<number, string>,
): ClientLessonSummary {
  const teacherId = row.teacher_telegram_id as number | null;
  return {
    id: row.id as number,
    topic: row.topic as string,
    startsAt: row.starts_at as string,
    kind: row.kind as ClientLessonKind,
    status: row.status as ClientLessonStatus,
    isPaid: (row.is_paid as boolean | null | undefined) ?? null,
    meetUrl: (row.meet_url as string | null) ?? null,
    teacherName: teacherId ? teachers.get(teacherId) ?? null : null,
  };
}

async function mapLessonRows(
  admin: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<ClientLessonSummary[]> {
  const teacherIds = rows.map((r) => r.teacher_telegram_id as number | null).filter(Boolean) as number[];
  const teachers = await loadTeacherNames(admin, teacherIds);
  return rows.map((row) => mapLessonRow(row, teachers));
}

export async function fetchNextClientLesson(
  admin: SupabaseClient,
  telegramId: number,
): Promise<ClientLessonSummary | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(LESSON_SELECT)
    .eq('telegram_id', telegramId)
    .eq('status', 'scheduled')
    .gte('starts_at', now)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [lesson] = await mapLessonRows(admin, [data as Record<string, unknown>]);
  return lesson ?? null;
}

export async function fetchFutureClientLessons(
  admin: SupabaseClient,
  telegramId: number,
  limit = 30,
): Promise<ClientLessonSummary[]> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(LESSON_SELECT)
    .eq('telegram_id', telegramId)
    .eq('status', 'scheduled')
    .gte('starts_at', now)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return mapLessonRows(admin, (data ?? []) as Record<string, unknown>[]);
}

export async function fetchPastClientLessons(
  admin: SupabaseClient,
  telegramId: number,
  options?: { page?: number; pageSize?: number },
): Promise<{ items: ClientLessonSummary[]; page: number; hasMore: boolean }> {
  const page = Math.max(0, options?.page ?? 0);
  const pageSize = options?.pageSize ?? 10;
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const now = new Date().toISOString();

  const { data, error, count } = await admin
    .from('scheduled_lessons')
    .select(LESSON_SELECT, { count: 'exact' })
    .eq('telegram_id', telegramId)
    .or(`status.in.(completed,no_show),and(status.eq.scheduled,starts_at.lt.${now})`)
    .order('starts_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const items = await mapLessonRows(admin, (data ?? []) as Record<string, unknown>[]);
  const total = count ?? items.length;
  return { items, page, hasMore: total > to + 1 };
}

export async function fetchClientLessonDetail(
  admin: SupabaseClient,
  telegramId: number,
  lessonId: number,
): Promise<ClientLessonDetail | null> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(LESSON_SELECT)
    .eq('id', lessonId)
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [summary] = await mapLessonRows(admin, [data as Record<string, unknown>]);
  if (!summary) return null;

  const [{ count: materialsCount }, homeworkRes] = await Promise.all([
    admin
      .from('lesson_materials')
      .select('id', { count: 'exact', head: true })
      .eq('lesson_id', lessonId),
    admin
      .from('homework_assignments')
      .select('id, file_name, review_status')
      .eq('lesson_id', lessonId)
      .maybeSingle(),
  ]);

  if (homeworkRes.error) throw homeworkRes.error;

  return {
    ...summary,
    durationMinutes: (data.duration_minutes as number) ?? 60,
    lessonPlan: (data.lesson_plan as string | null) ?? null,
    materialsCount: materialsCount ?? 0,
    homework: homeworkRes.data
      ? {
          id: homeworkRes.data.id as number,
          fileName: homeworkRes.data.file_name as string,
          reviewStatus: homeworkRes.data.review_status as string,
        }
      : null,
  };
}

export function homeworkStatusLabel(status: string): string {
  if (
    status === 'pending' ||
    status === 'submitted' ||
    status === 'reviewing' ||
    status === 'done' ||
    status === 'revision'
  ) {
    return homeworkReviewStatusLabel(status as LessonHomeworkReviewStatus);
  }
  return status;
}

export { kindLabel };

export type ClientPackageView = {
  id: number;
  product: 'individual' | 'group';
  title: string;
  total: number;
  used: number;
  remaining: number;
  status: string;
};

export async function fetchClientPackages(
  admin: SupabaseClient,
  telegramId: number,
): Promise<ClientPackageView[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, product, title, total_lessons, used_lessons, remaining_lessons, status')
    .eq('telegram_id', telegramId)
    .in('product', ['individual', 'group'])
    .order('purchased_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as number,
    product: row.product as 'individual' | 'group',
    title: row.title as string,
    total: row.total_lessons as number,
    used: row.used_lessons as number,
    remaining: row.remaining_lessons as number,
    status: row.status as string,
  }));
}
