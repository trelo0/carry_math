import { flattenCourseLessons, getDistrictCourseContent } from '@/lib/studio/courseContent';
import type { CuratorLibraryTask, CuratorLibraryWebinar } from './curator-types';

export async function loadCuratorLibrary(): Promise<CuratorLibraryWebinar[]> {
  const content = await getDistrictCourseContent();
  if (!content) return [];

  const lessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published' && l.lessonType === 'webinar')
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  return lessons
    .map((lesson) => {
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
          title: file.title || file.fileName || 'Материал',
          condition: file.title || 'Файл домашнего задания.',
          fileUrl: file.url,
        });
      }
      if (tasks.length === 0 && lesson.mandatoryHomework) {
        tasks.push({
          id: `${lessonKey}:hw`,
          title: `Домашнее задание №${lesson.lessonNumber}`,
          condition: lesson.description ?? 'Домашнее задание к занятию.',
          fileUrl: null,
        });
      }
      return {
        id: lessonKey,
        title: `Занятие ${lesson.lessonNumber}. ${lesson.title}`,
        tasks,
      };
    })
    .filter((webinar) => webinar.tasks.length > 0);
}
