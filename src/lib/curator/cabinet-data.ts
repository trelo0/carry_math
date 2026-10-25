import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchCuratorLessonFilesMap,
  getDistrictCourseContent,
  type CourseLessonContent,
  type CuratorRawLessonFile,
} from '@/lib/studio/courseContent';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityLessonSessionRow,
  type SanityWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  buildHomeworkBoard,
  loadCuratorCourseStudents,
  type CuratorHomeworkBoardItem,
  type CuratorStudentView,
} from '@/lib/curator/students';
import {
  compareCuratorLessonsProgramOrder,
  ensureCourseLessonIndices,
  findLastCompletedCuratorLesson,
  findNextProgramCuratorLesson,
} from '@/lib/curator/lesson-program-order';

export { compareCuratorLessonsProgramOrder } from '@/lib/curator/lesson-program-order';

export type CuratorLessonSessionStatus = SanityWebinarSessionStatus;

export type CuratorLessonFileView = {
  index: number;
  fileName: string | null;
  fileUrl: string | null;
  published: boolean;
};

export type CuratorLessonView = {
  sanityId: string;
  lessonNumber: number;
  /** Сквозной № занятия в курсе (модули по порядку). */
  courseLessonIndex: number;
  title: string;
  moduleTitle: string;
  moduleIndex: number;
  lessonDate: string | null;
  scheduledAt: string | null;
  liveUrl: string | null;
  recordingUrl: string | null;
  sessionStatus: CuratorLessonSessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  materials: CuratorLessonFileView[];
  homeworkFiles: CuratorLessonFileView[];
};

export type CuratorHomeworkQueueItem = CuratorHomeworkBoardItem;

export type CuratorStudentViewExport = CuratorStudentView;

export type CuratorDashboard = {
  studentCount: number;
  awaitingReview: number;
  notSubmitted: number;
  revision: number;
  liveNow: number;
  upcomingCount: number;
  lastLesson: CuratorLessonView | null;
  nextLesson: CuratorLessonView | null;
  liveLessons: CuratorLessonView[];
};

export type CuratorCourseListItem = {
  courseId: number;
  slug: string;
  title: string;
  studentCount: number;
  lessonCount: number;
  role: 'curator' | 'check';
};

export type CuratorCabinetData = {
  /** Имя того, кто смотрит кабинет. */
  curatorName: string | null;
  /** Имя назначенного куратора курса (course_staff_assignments → бот, иначе Sanity). */
  courseCuratorName?: string | null;
  courseTitle: string;
  courseSlug: string | null;
  courseId: number | null;
  /** Роль на активном courseId (из course_staff_assignments). */
  activeCourseRole: 'curator' | 'check' | null;
  assignedCourses: CuratorCourseListItem[];
  sanityWriteEnabled: boolean;
  dashboard: CuratorDashboard;
  lessons: CuratorLessonView[];
  modules: { title: string; color: string; lessonIds: string[] }[];
  students: CuratorStudentView[];
  homeworkBoard: CuratorHomeworkBoardItem[];
  homeworkQueue: CuratorHomeworkQueueItem[];
};

function mapLessonFiles(items: CuratorRawLessonFile[]): CuratorLessonFileView[] {
  return items.map((item, index) => ({
    index,
    fileName: item.fileName,
    fileUrl: item.fileUrl,
    published: item.published,
  }));
}

function toLessonView(
  lesson: CourseLessonContent,
  moduleTitle: string,
  moduleIndex: number,
  courseLessonIndex: number,
  sessionRow: SanityLessonSessionRow | undefined,
  files?: { materials: CuratorRawLessonFile[]; homeworkFiles: CuratorRawLessonFile[] },
): CuratorLessonView {
  return {
    sanityId: lesson.sanityId,
    lessonNumber: lesson.lessonNumber,
    courseLessonIndex,
    title: lesson.title,
    moduleTitle,
    moduleIndex,
    lessonDate: lesson.lessonDate,
    scheduledAt: lesson.scheduledAt,
    liveUrl: lesson.liveUrl,
    recordingUrl: lesson.recordingUrl,
    sessionStatus: resolveWebinarSessionStatus(
      lesson.scheduledAt,
      sessionRow,
      lesson.recordingUrl,
    ),
    startedAt: sessionRow?.started_at ?? null,
    endedAt: sessionRow?.ended_at ?? null,
    materials: mapLessonFiles(files?.materials ?? []),
    homeworkFiles: mapLessonFiles(files?.homeworkFiles ?? []),
  };
}

function summarizeHomework(students: CuratorStudentView[]) {
  let awaitingReview = 0;
  let notSubmitted = 0;
  let revision = 0;
  for (const student of students) {
    awaitingReview += student.homeworks.filter((hw) => hw.status === 'submitted').length;
    notSubmitted += student.homeworks.filter((hw) => hw.status === 'waiting').length;
    revision += student.homeworks.filter((hw) => hw.status === 'revision').length;
  }
  return { awaitingReview, notSubmitted, revision };
}

/** Нормализация после SSR/кэша: сквозные № и блок «последнее / ближайшее». */
export function normalizeCuratorCabinetData(data: CuratorCabinetData): CuratorCabinetData {
  const lessons = ensureCourseLessonIndices(data.lessons);
  const liveLessons = lessons.filter((l) => l.sessionStatus === 'live');
  const upcomingCount = lessons.filter(
    (l) => l.sessionStatus === 'scheduled' || l.sessionStatus === 'waiting',
  ).length;
  return {
    ...data,
    lessons,
    dashboard: {
      ...data.dashboard,
      liveNow: liveLessons.length,
      upcomingCount,
      lastLesson: findLastCompletedCuratorLesson(lessons),
      nextLesson: findNextProgramCuratorLesson(lessons),
      liveLessons,
    },
  };
}

/** Имя активного куратора курса из назначений + участника бота. */
async function resolveCourseCuratorName(
  admin: SupabaseClient,
  courseId: number,
): Promise<string | null> {
  try {
    const { listActiveCourseStaff } = await import('@/lib/bot/education/course-staff');
    const rows = await listActiveCourseStaff(admin, courseId, 'curator');
    const id = rows[0]?.staff_telegram_id;
    if (id == null) return null;
    const { data } = await admin
      .from('bot_members')
      .select('full_name')
      .eq('telegram_id', id)
      .maybeSingle();
    return ((data?.full_name as string | null) ?? '').trim() || `ID ${id}`;
  } catch {
    return null;
  }
}

export async function getCuratorCabinetData(
  admin: SupabaseClient,
  curatorTelegramId: number,
  curatorName: string | null,
  options?: {
    courseId?: number | null;
    courseSlug?: string | null;
    courseRole?: 'curator' | 'check' | null;
    fullPreview?: boolean;
    /** Не считать список всех курсов (клиент уже его имеет) — заметно быстрее. */
    skipCourseList?: boolean;
  },
): Promise<CuratorCabinetData> {
  const { listStaffCourseAssignmentOptions, resolveStaffCourseContext } = await import(
    '@/lib/curator/course-context'
  );
  const courseOptions = await listStaffCourseAssignmentOptions(admin, curatorTelegramId, {
    fullPreview: options?.fullPreview,
  });
  let activeCourse = await resolveStaffCourseContext(admin, curatorTelegramId, {
    courseId: options?.courseId,
    courseSlug: options?.courseSlug,
    courseRole: options?.courseRole,
    fullPreview: options?.fullPreview,
    preloaded: courseOptions,
  });
  if (!options?.fullPreview && activeCourse?.role === 'check') {
    activeCourse = await resolveStaffCourseContext(admin, curatorTelegramId, {
      courseId: options?.courseId ?? activeCourse.courseId,
      courseSlug: options?.courseSlug ?? activeCourse.slug,
      courseRole: 'curator',
      fullPreview: false,
      preloaded: courseOptions,
    });
  }
  const activeCourseRole = activeCourse?.role ?? null;

  // Ученики курса грузятся параллельно с контентом/файлами/сессиями (меньше последовательных запросов).
  const studentsPromise =
    activeCourse && activeCourse.courseId && activeCourse.slug
      ? loadCuratorCourseStudents(admin, curatorTelegramId, {
          courseId: activeCourse.courseId,
          courseSlug: activeCourse.slug,
          skipStaffCheck: options?.fullPreview,
        })
      : Promise.resolve({ courseId: null, students: [] as CuratorStudentView[] });

  const curatorNamePromise = activeCourse?.courseId
    ? resolveCourseCuratorName(admin, activeCourse.courseId)
    : Promise.resolve(null);

  const content = activeCourse
    ? await getDistrictCourseContent(activeCourse.slug)
    : await getDistrictCourseContent();
  const courseTitle = content?.title ?? activeCourse?.title ?? 'Курс District';
  const courseSlug = activeCourse?.slug ?? content?.slug ?? null;

  const lessons: CuratorLessonView[] = [];
  const modules: CuratorCabinetData['modules'] = [];

  if (content) {
    const lessonIds: string[] = [];
    for (const mod of content.modules) {
      const modLessonIds: string[] = [];
      for (const lesson of mod.lessons) {
        if (lesson.publicationStatus === 'archived') continue;
        lessonIds.push(lesson.sanityId);
        modLessonIds.push(lesson.sanityId);
      }
      if (modLessonIds.length) {
        modules.push({ title: mod.title, color: mod.color, lessonIds: modLessonIds });
      }
    }

    const [filesMap, sessionMap] = await Promise.all([
      fetchCuratorLessonFilesMap(lessonIds),
      loadSanityLessonSessionMap(admin, lessonIds),
    ]);

    let courseLessonIndex = 0;
    content.modules.forEach((mod, moduleIndex) => {
      for (const lesson of mod.lessons) {
        if (lesson.publicationStatus === 'archived') continue;
        courseLessonIndex += 1;
        lessons.push(
          toLessonView(
            lesson,
            mod.title,
            moduleIndex,
            courseLessonIndex,
            sessionMap.get(lesson.sanityId),
            filesMap.get(lesson.sanityId),
          ),
        );
      }
    });
    lessons.sort(compareCuratorLessonsProgramOrder);
  }

  const courseId = activeCourse?.courseId ?? null;
  const { students } = await studentsPromise;

  const countLessons = (c: NonNullable<typeof content>) =>
    c.modules.reduce(
      (n, m) => n + m.lessons.filter((l) => l.publicationStatus !== 'archived').length,
      0,
    );
  // Параллельно; активный курс переиспользует уже загруженные контент и учеников.
  const assignedCourses: CuratorCourseListItem[] = await Promise.all(
    (options?.skipCourseList ? [] : courseOptions)
      .filter((pick) => options?.fullPreview || pick.role !== 'check')
      .map(async (pick): Promise<CuratorCourseListItem> => {
        const isActive = activeCourse != null && pick.courseId === activeCourse.courseId;
        const [summaryContent, pickStudents] = await Promise.all([
          isActive && content
            ? Promise.resolve(content)
            : getDistrictCourseContent(pick.slug).catch(() => null),
          isActive
            ? Promise.resolve(students)
            : loadCuratorCourseStudents(admin, curatorTelegramId, {
                courseId: pick.courseId,
                courseSlug: pick.slug,
                skipStaffCheck: options?.fullPreview,
              }).then((r) => r.students),
        ]);
        return {
          courseId: pick.courseId,
          slug: pick.slug,
          title: pick.title,
          studentCount: pickStudents.length,
          lessonCount: summaryContent ? countLessons(summaryContent) : 0,
          role: pick.role,
        };
      }),
  );

  const hwSummary = summarizeHomework(students);
  const homeworkBoard = buildHomeworkBoard(students, content);
  const liveLessons = lessons.filter((l) => l.sessionStatus === 'live');
  const upcomingCount = lessons.filter(
    (l) => l.sessionStatus === 'scheduled' || l.sessionStatus === 'waiting',
  ).length;

  const courseCuratorName = (await curatorNamePromise) ?? content?.curatorName ?? null;

  return normalizeCuratorCabinetData({
    curatorName,
    courseCuratorName,
    courseTitle,
    courseSlug,
    courseId,
    activeCourseRole,
    assignedCourses,
    sanityWriteEnabled: Boolean(process.env.SANITY_API_WRITE_TOKEN),
    dashboard: {
      studentCount: students.length,
      awaitingReview: hwSummary.awaitingReview,
      notSubmitted: hwSummary.notSubmitted,
      revision: hwSummary.revision,
      liveNow: liveLessons.length,
      upcomingCount,
      lastLesson: findLastCompletedCuratorLesson(lessons),
      nextLesson: findNextProgramCuratorLesson(lessons),
      liveLessons,
    },
    lessons,
    modules,
    students,
    homeworkBoard,
    homeworkQueue: homeworkBoard.filter((item) => item.status === 'submitted'),
  });
}

export function getCuratorLessonById(
  data: CuratorCabinetData,
  sanityLessonId: string,
): CuratorLessonView | undefined {
  return data.lessons.find((l) => l.sanityId === sanityLessonId);
}
