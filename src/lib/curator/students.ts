import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  type CourseLessonContent,
} from '@/lib/studio/courseContent';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import { mapProgressToCuratorStatus } from '@/lib/bot/education/course-homework';
import type { CourseLessonStudentProgress } from '@/lib/bot/education/course-progress';
import type { CuratorHomeworkRecord, CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import type { CuratorHwStatus } from '@/lib/bot/curator/curator-types';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityWebinarSessionStatus,
} from '@/lib/curator/lesson-session';

const ACTIVE = 'active';

function mapToCuratorHwStatus(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  hasAccess: boolean,
  sessionStatus: SanityWebinarSessionStatus,
): CuratorHwStatus {
  const status = mapProgressToCuratorStatus(lesson, progress, hasAccess, sessionStatus);
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  if (status === 'rejected') return 'revision';
  if (status === 'pending') return 'waiting';
  if (status === 'upcoming') return 'upcoming';
  return 'waiting';
}

async function studentDisplayName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from('student_profiles').select('display_name').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  return (
    (profile?.display_name as string | undefined) ||
    (member?.full_name as string | undefined) ||
    `Ученик ${telegramId}`
  );
}

/** Ученики с активным доступом к курсу (покупка / зачисление). */
export async function listCourseStudentTelegramIds(
  admin: SupabaseClient,
  courseId: number,
): Promise<number[]> {
  const ids = new Set<number>();

  const [{ data: enrollments }, { data: accesses }] = await Promise.all([
    admin
      .from('course_enrollments')
      .select('telegram_id')
      .eq('course_id', courseId)
      .eq('status', ACTIVE),
    admin
      .from('user_accesses')
      .select('telegram_id, expires_at')
      .eq('product', 'course')
      .eq('status', ACTIVE),
  ]);

  for (const row of enrollments ?? []) {
    ids.add(row.telegram_id as number);
  }

  const now = Date.now();
  for (const row of accesses ?? []) {
    const exp = row.expires_at as string | null;
    if (exp && Date.parse(exp) < now) continue;
    ids.add(row.telegram_id as number);
  }

  return [...ids];
}

export type CuratorStudentView = CuratorStudentRecord & {
  livesCurrent: number | null;
  livesMax: number | null;
  accessBlocked: boolean;
  phone: string | null;
  chatId: number | null;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  enrolledAt: string | null;
};

export async function loadCuratorCourseStudents(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<{ courseId: number | null; students: CuratorStudentView[] }> {
  const content = await getDistrictCourseContent();
  if (!content) return { courseId: null, students: [] };

  let courseId: number | null = null;
  try {
    courseId = await resolveCourseIdForContent(admin, content);
  } catch {
    courseId = null;
  }
  if (!courseId) return { courseId: null, students: [] };

  const studentIds = await listCourseStudentTelegramIds(admin, courseId);
  if (studentIds.length === 0) return { courseId, students: [] };

  const publishedLessons = flattenCourseLessons(content).filter(
    (l) => l.publicationStatus === 'published',
  );
  const homeworkLessons = publishedLessons.filter((l) => l.mandatoryHomework || l.homework);
  const sanityIds = publishedLessons.map((l) => l.sanityId);

  const sessionMap = await loadSanityLessonSessionMap(admin, sanityIds);

  const [{ data: accessRows }, { data: progressRows }, { data: members }] = await Promise.all([
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
    admin
      .from('bot_members')
      .select('telegram_id, full_name, phone, chat_id')
      .in('telegram_id', studentIds),
  ]);

  const accessMap = new Map<string, string>();
  for (const row of accessRows ?? []) {
    accessMap.set(`${row.telegram_id}:${row.sanity_lesson_id}`, row.access_status as string);
  }
  const progressMap = new Map<string, CourseLessonStudentProgress>();
  for (const row of progressRows ?? []) {
    progressMap.set(`${row.telegram_id}:${row.sanity_lesson_id}`, row as CourseLessonStudentProgress);
  }
  const memberMap = new Map(
    (members ?? []).map((m) => [m.telegram_id as number, m as { phone: string | null; chat_id: number | null }]),
  );

  const { data: enrollmentDates } = await admin
    .from('course_enrollments')
    .select('telegram_id, started_at')
    .eq('course_id', courseId)
    .in('telegram_id', studentIds);

  const enrolledAtMap = new Map<number, string>();
  for (const row of enrollmentDates ?? []) {
    enrolledAtMap.set(row.telegram_id as number, row.started_at as string);
  }

  const students: CuratorStudentView[] = [];

  for (const telegramId of studentIds) {
    const homeworks: CuratorHomeworkRecord[] = homeworkLessons.map((lesson) => {
      const key = `${telegramId}:${lesson.sanityId}`;
      const access = accessMap.get(key);
      const hasAccess = access === 'available' || access === 'blocked_lives';
      const progress = progressMap.get(key);
      const sessionStatus = resolveWebinarSessionStatus(
        lesson.scheduledAt,
        sessionMap.get(lesson.sanityId),
      );
      return {
        number: lesson.lessonNumber,
        sanityLessonId: lesson.sanityId,
        title: lesson.title,
        status: mapToCuratorHwStatus(lesson, progress, hasAccess, sessionStatus),
        submissionFileUrl: progress?.submission_file_url ?? null,
        submissionNote: progress?.submission_note ?? null,
      };
    });

    let livesCurrent: number | null = null;
    let livesMax: number | null = null;
    let accessBlocked = false;
    try {
      const lives = await getEnrollmentLives(admin, telegramId, courseId);
      livesCurrent = lives?.lives_current ?? null;
      livesMax = lives?.lives_max ?? null;
      accessBlocked = Boolean(lives?.access_blocked);
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }

    const completedLessons = publishedLessons.filter((lesson) => {
      const p = progressMap.get(`${telegramId}:${lesson.sanityId}`);
      return Boolean(p?.completed_at);
    }).length;
    const totalLessons = publishedLessons.length;
    const progressPercent =
      totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    const member = memberMap.get(telegramId);

    students.push({
      id: String(telegramId),
      telegramId,
      name: await studentDisplayName(admin, telegramId),
      homeworks,
      livesCurrent,
      livesMax,
      accessBlocked,
      phone: member?.phone ?? null,
      chatId: member?.chat_id ?? null,
      progressPercent,
      completedLessons,
      totalLessons,
      enrolledAt: enrolledAtMap.get(telegramId) ?? null,
    });
  }

  students.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { courseId, students };
}

export type CuratorHomeworkBoardItem = CuratorHomeworkRecord & {
  studentId: string;
  studentTelegramId: number;
  studentName: string;
  moduleTitle: string;
};

export function buildHomeworkBoard(
  students: CuratorStudentView[],
  content: Awaited<ReturnType<typeof getDistrictCourseContent>>,
): CuratorHomeworkBoardItem[] {
  if (!content) return [];
  const moduleByLesson = new Map<string, string>();
  for (const mod of content.modules) {
    for (const lesson of mod.lessons) {
      moduleByLesson.set(lesson.sanityId, mod.title);
    }
  }

  const out: CuratorHomeworkBoardItem[] = [];
  for (const student of students) {
    for (const hw of student.homeworks) {
      if (hw.status === 'upcoming') continue;
      if (hw.status === 'waiting' && !hw.submissionFileUrl && !hw.submissionNote) continue;
      out.push({
        ...hw,
        studentId: student.id,
        studentTelegramId: student.telegramId,
        studentName: student.name,
        moduleTitle: moduleByLesson.get(hw.sanityLessonId) ?? 'Модуль',
      });
    }
  }

  out.sort((a, b) => {
    if (a.status === 'submitted' && b.status !== 'submitted') return -1;
    if (b.status === 'submitted' && a.status !== 'submitted') return 1;
    return a.number - b.number || a.studentName.localeCompare(b.studentName, 'ru');
  });
  return out;
}
