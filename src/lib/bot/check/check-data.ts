import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCuratorStudents, type CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import { loadCuratorCourseStudents, type CuratorStudentView } from '@/lib/curator/students';
import { collectCuratorHomeworkQueue, type CuratorHomeworkListItem } from '@/lib/bot/staff/curator-homework-screens';
import type { CuratorHomeworkQueueKind } from '@/lib/bot/staff/curator-homework-screens';
import { assertCheckCourseAccess } from './check-access';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

export async function loadCourseModuleLessonMap(
  courseSlug: string,
): Promise<Map<number, Set<number>>> {
  const content = await getDistrictCourseContent(courseSlug);
  const map = new Map<number, Set<number>>();
  if (!content) return map;
  content.modules.forEach((mod, index) => {
    map.set(
      index,
      new Set(mod.lessons.map((l) => l.lessonNumber)),
    );
  });
  return map;
}

export function filterStudentsByName<T extends { name: string }>(students: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return students;
  return students.filter((s) => s.name.toLowerCase().includes(q));
}

const studentListSearchCache = new Map<string, string>();

export function studentSearchKey(courseId: number, staffId: number): string {
  return `${staffId}:${courseId}`;
}

export function setCheckStudentSearchQuery(courseId: number, staffId: number, query: string): void {
  studentListSearchCache.set(studentSearchKey(courseId, staffId), query);
}

export function getCheckStudentSearchQuery(courseId: number, staffId: number): string | undefined {
  return studentListSearchCache.get(studentSearchKey(courseId, staffId));
}

export function clearCheckStudentSearchQuery(courseId: number, staffId: number): void {
  studentListSearchCache.delete(studentSearchKey(courseId, staffId));
}

export async function loadCheckHomeworkStudents(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
): Promise<{ courseSlug: string; courseTitle: string; students: CuratorStudentRecord[] }> {
  const ctx = await assertCheckCourseAccess(admin, checkTelegramId, courseId);
  const students = await loadCuratorStudents(admin, checkTelegramId, {
    courseId: ctx.courseId,
    courseSlug: ctx.slug,
  });
  return { courseSlug: ctx.slug, courseTitle: ctx.title, students };
}

export async function loadCheckStudentViews(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
): Promise<{ courseTitle: string; students: CuratorStudentView[] }> {
  const ctx = await assertCheckCourseAccess(admin, checkTelegramId, courseId);
  const { students } = await loadCuratorCourseStudents(admin, checkTelegramId, {
    courseId: ctx.courseId,
    courseSlug: ctx.slug,
  });
  return { courseTitle: ctx.title, students };
}

export function collectCheckQueue(
  students: CuratorStudentRecord[],
  kind: CuratorHomeworkQueueKind,
): CuratorHomeworkListItem[] {
  return collectCuratorHomeworkQueue(students, kind);
}

/** «На проверку» = submitted */
export function collectCheckPending(students: CuratorStudentRecord[]): CuratorHomeworkListItem[] {
  return collectCheckQueue(students, 'pending');
}

/** Архив = только проверенные (одобрено / на доработке), без очереди «на проверке» и «не сдано». */
export function collectCheckArchive(students: CuratorStudentRecord[]): CuratorHomeworkListItem[] {
  return collectCheckQueue(students, 'all').filter(
    (item) => item.homework.status === 'approved' || item.homework.status === 'revision',
  );
}

export async function loadCheckHomeStats(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
): Promise<{ unreadMessages: number; pendingHomework: number }> {
  const { listCourseStudentTelegramIds } = await import('@/lib/curator/students');
  const { listCheckThreadsForCourse } = await import('@/lib/bot/staff/messaging');
  const studentIds = await listCourseStudentTelegramIds(admin, courseId);
  const [{ threads }, { students }] = await Promise.all([
    listCheckThreadsForCourse(admin, checkTelegramId, courseId, studentIds),
    loadCheckHomeworkStudents(admin, checkTelegramId, courseId),
  ]);
  return {
    unreadMessages: threads.reduce((sum, t) => sum + t.unreadCount, 0),
    pendingHomework: collectCheckPending(students).length,
  };
}
