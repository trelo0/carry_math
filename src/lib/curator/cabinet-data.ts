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

export type CuratorCabinetData = {
  curatorName: string | null;
  courseTitle: string;
  courseId: number | null;
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
  sessionRow: SanityLessonSessionRow | undefined,
  files?: { materials: CuratorRawLessonFile[]; homeworkFiles: CuratorRawLessonFile[] },
): CuratorLessonView {
  return {
    sanityId: lesson.sanityId,
    lessonNumber: lesson.lessonNumber,
    title: lesson.title,
    moduleTitle,
    moduleIndex,
    lessonDate: lesson.lessonDate,
    scheduledAt: lesson.scheduledAt,
    liveUrl: lesson.liveUrl,
    recordingUrl: lesson.recordingUrl,
    sessionStatus: resolveWebinarSessionStatus(lesson.scheduledAt, sessionRow),
    startedAt: sessionRow?.started_at ?? null,
    endedAt: sessionRow?.ended_at ?? null,
    materials: mapLessonFiles(files?.materials ?? []),
    homeworkFiles: mapLessonFiles(files?.homeworkFiles ?? []),
  };
}

function findLastCompletedLesson(lessons: CuratorLessonView[]): CuratorLessonView | null {
  const completed = lessons
    .filter((l) => l.sessionStatus === 'completed')
    .sort((a, b) => {
      const ta = a.endedAt
        ? new Date(a.endedAt).getTime()
        : a.scheduledAt
          ? new Date(a.scheduledAt).getTime()
          : 0;
      const tb = b.endedAt
        ? new Date(b.endedAt).getTime()
        : b.scheduledAt
          ? new Date(b.scheduledAt).getTime()
          : 0;
      return tb - ta;
    });
  return completed[0] ?? null;
}

function findNextLesson(lessons: CuratorLessonView[]): CuratorLessonView | null {
  return (
    [...lessons]
      .sort((a, b) => a.lessonNumber - b.lessonNumber)
      .find(
        (l) =>
          l.sessionStatus !== 'completed' &&
          l.sessionStatus !== 'cancelled' &&
          l.sessionStatus !== 'live',
      ) ?? null
  );
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

export async function getCuratorCabinetData(
  admin: SupabaseClient,
  curatorTelegramId: number,
  curatorName: string | null,
): Promise<CuratorCabinetData> {
  const content = await getDistrictCourseContent();
  const courseTitle = content?.title ?? 'Курс District';

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

    content.modules.forEach((mod, moduleIndex) => {
      for (const lesson of mod.lessons) {
        if (lesson.publicationStatus === 'archived') continue;
        lessons.push(
          toLessonView(
            lesson,
            mod.title,
            moduleIndex,
            sessionMap.get(lesson.sanityId),
            filesMap.get(lesson.sanityId),
          ),
        );
      }
    });
    lessons.sort((a, b) => a.lessonNumber - b.lessonNumber);
  }

  const { courseId, students } = await loadCuratorCourseStudents(admin, curatorTelegramId);
  const hwSummary = summarizeHomework(students);
  const homeworkBoard = buildHomeworkBoard(students, content);
  const liveLessons = lessons.filter((l) => l.sessionStatus === 'live');
  const upcomingCount = lessons.filter(
    (l) => l.sessionStatus === 'scheduled' || l.sessionStatus === 'waiting',
  ).length;

  return {
    curatorName,
    courseTitle,
    courseId,
    sanityWriteEnabled: Boolean(process.env.SANITY_API_WRITE_TOKEN),
    dashboard: {
      studentCount: students.length,
      awaitingReview: hwSummary.awaitingReview,
      notSubmitted: hwSummary.notSubmitted,
      revision: hwSummary.revision,
      liveNow: liveLessons.length,
      upcomingCount,
      lastLesson: findLastCompletedLesson(lessons),
      nextLesson: findNextLesson(lessons),
      liveLessons,
    },
    lessons,
    modules,
    students,
    homeworkBoard,
    homeworkQueue: homeworkBoard.filter((item) => item.status === 'submitted'),
  };
}

export function getCuratorLessonById(
  data: CuratorCabinetData,
  sanityLessonId: string,
): CuratorLessonView | undefined {
  return data.lessons.find((l) => l.sanityId === sanityLessonId);
}
