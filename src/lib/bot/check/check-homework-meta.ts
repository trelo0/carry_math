import type { SupabaseClient } from '@supabase/supabase-js';
import type { CuratorHomeworkListItem } from '@/lib/bot/staff/curator-homework-screens';
import type { CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

export type CheckHwMeta = {
  submittedAt: string | null;
  deadlineAt: string | null;
  overdue: boolean;
  moduleTitle: string;
  lessonTitle: string;
};

function isOverdueProgress(row: {
  homework_deadline_at: string | null;
  homework_overdue_at: string | null;
}): boolean {
  if (row.homework_overdue_at) return true;
  if (!row.homework_deadline_at) return false;
  const t = Date.parse(row.homework_deadline_at);
  return Number.isFinite(t) && t <= Date.now();
}

export type CheckHomeworkListItem = CuratorHomeworkListItem & { meta?: CheckHwMeta };

export async function loadCheckHwMetaMap(
  admin: SupabaseClient,
  courseSlug: string,
  students: CuratorStudentRecord[],
): Promise<Map<string, CheckHwMeta>> {
  const content = await getDistrictCourseContent(courseSlug);
  const out = new Map<string, CheckHwMeta>();
  if (!content || students.length === 0) return out;

  const sanityToLesson = new Map<
    string,
    { lessonNumber: number; moduleTitle: string; lessonTitle: string }
  >();
  for (const mod of content.modules) {
    for (const lesson of mod.lessons) {
      sanityToLesson.set(lesson.sanityId, {
        lessonNumber: lesson.lessonNumber,
        moduleTitle: mod.title,
        lessonTitle: lesson.title,
      });
    }
  }

  const studentIds = students.map((s) => s.telegramId);
  const sanityIds = [...sanityToLesson.keys()];
  if (sanityIds.length === 0) return out;

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'telegram_id, sanity_lesson_id, homework_submitted_at, homework_deadline_at, homework_overdue_at',
    )
    .in('telegram_id', studentIds)
    .in('sanity_lesson_id', sanityIds);
  if (error) {
    const msg = String(error.message ?? error);
    if (msg.includes('homework_deadline_at')) return out;
    throw error;
  }

  for (const row of data ?? []) {
    const tg = row.telegram_id as number;
    const sanityId = row.sanity_lesson_id as string;
    const lesson = sanityToLesson.get(sanityId);
    if (!lesson) continue;
    const key = `${tg}:${lesson.lessonNumber}`;
    out.set(key, {
      submittedAt: (row.homework_submitted_at as string | null) ?? null,
      deadlineAt: (row.homework_deadline_at as string | null) ?? null,
      overdue: isOverdueProgress({
        homework_deadline_at: row.homework_deadline_at as string | null,
        homework_overdue_at: row.homework_overdue_at as string | null,
      }),
      moduleTitle: lesson.moduleTitle,
      lessonTitle: lesson.lessonTitle,
    });
  }
  return out;
}

export function attachMetaToQueueItems(
  items: CuratorHomeworkListItem[],
  metaMap: Map<string, CheckHwMeta>,
): CheckHomeworkListItem[] {
  return items.map((item) => {
    const key = `${item.studentId}:${item.homework.number}`;
    const meta = metaMap.get(key);
    return meta ? { ...item, meta } : item;
  });
}

export type CheckHwListFilters = {
  studentTelegramId?: number;
  moduleIndex?: number;
  lessonNumber?: number;
};

export function applyCheckHwFilters(
  items: CheckHomeworkListItem[],
  filters: CheckHwListFilters,
  moduleLessonNumbers?: Map<number, Set<number>>,
): CheckHomeworkListItem[] {
  let out = items;
  if (filters.studentTelegramId != null) {
    const sid = String(filters.studentTelegramId);
    out = out.filter((i) => i.studentId === sid);
  }
  if (filters.lessonNumber != null) {
    out = out.filter((i) => i.homework.number === filters.lessonNumber);
  }
  if (filters.moduleIndex != null && moduleLessonNumbers) {
    const nums = moduleLessonNumbers.get(filters.moduleIndex);
    if (nums) out = out.filter((i) => nums.has(i.homework.number));
  }
  return out;
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): { pageItems: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages };
}

export const CHECK_LIST_PAGE_SIZE = 12;

export function formatCheckHwWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Minsk',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
