import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadCuratorCourseStudents } from '@/lib/curator/students';

export type AdminStudentHomework = {
  number: number;
  title: string;
  status: 'submitted' | 'approved' | 'rejected' | 'revision' | 'waiting' | 'upcoming';
};

export type AdminCourseStudent = {
  telegramId: number;
  name: string;
  phone: string | null;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  enrolledAt: string | null;
  lastActivityAt: string | null;
  livesCurrent: number | null;
  livesMax: number | null;
  accessBlocked: boolean;
  fullyBlocked: boolean;
  overdueHomeworkCount: number;
  remainingPaidLessons: number;
  homeworks: AdminStudentHomework[];
};

export const COURSE_STUDENTS_TAG = 'admin-course-students';

/** Ученики курса: тяжёлый расчёт прогресса кэшируется на 30 с (сбрасывается при действиях в панели). */
export const loadAdminCourseStudentsCached = unstable_cache(
  async (courseId: number, slug: string): Promise<AdminCourseStudent[]> => {
    const { students } = await loadCuratorCourseStudents(createAdminClient(), 0, {
      courseId,
      courseSlug: slug,
      skipStaffCheck: true,
      fullPreview: true,
    });
    return students.map((s) => ({
      telegramId: s.telegramId,
      name: s.name,
      phone: s.phone,
      progressPercent: s.progressPercent,
      completedLessons: s.completedLessons,
      totalLessons: s.totalLessons,
      enrolledAt: s.enrolledAt,
      lastActivityAt: s.lastActivityAt,
      livesCurrent: s.livesCurrent,
      livesMax: s.livesMax,
      accessBlocked: s.accessBlocked,
      fullyBlocked: s.fullyBlocked,
      overdueHomeworkCount: s.overdueHomeworkCount,
      remainingPaidLessons: s.remainingPaidLessons,
      homeworks: s.homeworks.map((h) => ({ number: h.number, title: h.title, status: h.status })),
    }));
  },
  ['admin-course-students'],
  { revalidate: 30, tags: [COURSE_STUDENTS_TAG] },
);
