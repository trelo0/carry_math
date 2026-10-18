import { flattenCourseLessons, getDistrictCourseContent } from '@/lib/studio/courseContent';
import type { CuratorLibraryTask, CuratorLibraryWebinar } from '@/lib/bot/curator/curator-types';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';

export type CheckLibraryModule = {
  index: number;
  title: string;
  webinars: CuratorLibraryWebinar[];
};

export async function loadCheckCourseLibrary(
  courseSlug: string,
): Promise<{ courseTitle: string; modules: CheckLibraryModule[] } | null> {
  const content = await getDistrictCourseContent(courseSlug);
  if (!content) return null;
  return { courseTitle: content.title, modules: buildLibraryModules(content) };
}

function buildLibraryModules(content: DistrictCourseContent): CheckLibraryModule[] {
  const modules: CheckLibraryModule[] = [];
  content.modules.forEach((mod, index) => {
    const lessons = mod.lessons
      .filter((l) => l.publicationStatus === 'published' && l.lessonType === 'webinar')
      .sort((a, b) => a.lessonNumber - b.lessonNumber);
    const webinars: CuratorLibraryWebinar[] = [];
    for (const lesson of lessons) {
      const lessonKey = String(lesson.lessonNumber);
      const tasks: CuratorLibraryTask[] = [];
      if (lesson.homework?.title || lesson.homework?.description) {
        tasks.push({
          id: `${lessonKey}:hw`,
          title: lesson.homework?.title ?? `ДЗ №${lesson.lessonNumber}`,
          condition: lesson.homework?.description ?? lesson.description ?? 'Условие в материалах занятия.',
          fileUrl: lesson.homework?.url ?? null,
        });
      }
      for (const file of lesson.homeworkFiles) {
        tasks.push({
          id: `${lessonKey}:file:${file.fileName ?? file.title}`,
          title: file.title || file.fileName || 'Мaterial',
          condition: file.title || 'Файл домашнего задания.',
          fileUrl: file.url,
        });
      }
      for (const mat of lesson.materials) {
        if (mat.url) {
          tasks.push({
            id: `${lessonKey}:mat:${mat.title}`,
            title: mat.title,
            condition: mat.materialType === 'link' ? 'Ссылка на материал.' : 'Материал занятия.',
            fileUrl: mat.url,
          });
        }
      }
      if (tasks.length === 0 && lesson.mandatoryHomework) {
        tasks.push({
          id: `${lessonKey}:hw`,
          title: `Домашнее задание №${lesson.lessonNumber}`,
          condition: lesson.description ?? 'Домашнее задание к занятию.',
          fileUrl: null,
        });
      }
      if (tasks.length > 0) {
        webinars.push({
          id: lessonKey,
          title: `Занятие ${lesson.lessonNumber}. ${lesson.title}`,
          tasks,
        });
      }
    }
    if (webinars.length > 0) {
      modules.push({ index, title: mod.title, webinars });
    }
  });
  return modules;
}

/** Плоский список вебинаров с ДЗ (для совместимости). */
export async function loadCheckHomeworkLibraryFlat(courseSlug: string): Promise<CuratorLibraryWebinar[]> {
  const loaded = await loadCheckCourseLibrary(courseSlug);
  if (!loaded) return [];
  return loaded.modules.flatMap((m) => m.webinars);
}
