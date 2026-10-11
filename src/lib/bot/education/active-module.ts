import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictCourseContent, CourseModuleContent } from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
} from '@/lib/curator/lesson-session';

export type ActiveModuleResult = {
  module: CourseModuleContent | null;
  reason: string;
  source: 'manual' | 'auto_webinar' | 'auto_last_completed' | 'not_found';
};

/**
 * Определяет активный модуль курса для сценария "Подключиться к курсу".
 *
 * Приоритет:
 * 1. Ручной override из Sanity (activeModuleOverride)
 * 2. Автоматически по вебинарам:
 *    - Текущий live вебинар
 *    - Последний completed вебинар
 *    - Если нет completed, последний scheduled с прошедшей датой
 *
 * Не учитывает отменённые вебинары.
 * Возвращает null, если модуль определить невозможно.
 */
export async function determineActiveModule(
  admin: SupabaseClient,
  content: DistrictCourseContent,
): Promise<ActiveModuleResult> {
  // 1. Проверяем ручной override
  if (content.activeModuleOverride) {
    const overrideModule = content.modules.find((m) => m.sanityId === content.activeModuleOverride);
    if (overrideModule) {
      return {
        module: overrideModule,
        reason: 'Ручной выбор администратора',
        source: 'manual',
      };
    }
  }

  // 2. Автоматическое определение по вебинарам
  const lessons = flattenCourseLessons(content).filter((l) => l.lessonType === 'webinar');
  if (lessons.length === 0) {
    return {
      module: null,
      reason: 'В курсе нет вебинаров',
      source: 'not_found',
    };
  }

  const sanityIds = lessons.map((l) => l.sanityId);
  const sessionMap = await loadSanityLessonSessionMap(admin, sanityIds);

  // Ищем текущий live вебинар
  const now = Date.now();
  const liveLesson = lessons.find((lesson) => {
    const session = sessionMap.get(lesson.sanityId);
    const status = resolveWebinarSessionStatus(lesson.scheduledAt, session);
    return status === 'live';
  });

  if (liveLesson) {
    const activeModule = content.modules.find((m) =>
      m.lessons.some((l) => l.sanityId === liveLesson?.sanityId),
    );
    if (activeModule) {
      return {
        module: activeModule,
        reason: 'Текущий live вебинар',
        source: 'auto_webinar',
      };
    }
  }

  // Ищем последний completed вебинар
  const completedLessons = lessons
    .filter((lesson) => {
      const session = sessionMap.get(lesson.sanityId);
      const status = resolveWebinarSessionStatus(lesson.scheduledAt, session);
      return status === 'completed';
    })
    .sort((a, b) => {
      const aTime = a.scheduledAt ? Date.parse(a.scheduledAt) : 0;
      const bTime = b.scheduledAt ? Date.parse(b.scheduledAt) : 0;
      return bTime - aTime; // Сортировка по убыванию (самый последний)
    });

  if (completedLessons.length > 0) {
    const lastCompleted = completedLessons[0];
    const activeModule = content.modules.find((m) =>
      m.lessons.some((l) => l.sanityId === lastCompleted?.sanityId),
    );
    if (activeModule) {
      return {
        module: activeModule,
        reason: 'Последний завершённый вебинар',
        source: 'auto_last_completed',
      };
    }
  }

  // Если нет completed, берём последний scheduled с прошедшей датой
  const pastScheduledLessons = lessons
    .filter((lesson) => {
      const session = sessionMap.get(lesson.sanityId);
      const status = resolveWebinarSessionStatus(lesson.scheduledAt, session);
      if (status !== 'scheduled') return false;
      const scheduledTime = lesson.scheduledAt ? Date.parse(lesson.scheduledAt) : 0;
      return scheduledTime > 0 && scheduledTime <= now;
    })
    .sort((a, b) => {
      const aTime = a.scheduledAt ? Date.parse(a.scheduledAt) : 0;
      const bTime = b.scheduledAt ? Date.parse(b.scheduledAt) : 0;
      return bTime - aTime;
    });

  if (pastScheduledLessons.length > 0) {
    const lastPastScheduled = pastScheduledLessons[0];
    const activeModule = content.modules.find((m) =>
      m.lessons.some((l) => l.sanityId === lastPastScheduled?.sanityId),
    );
    if (activeModule) {
      return {
        module: activeModule,
        reason: 'Последний запланированный вебинар с прошедшей датой',
        source: 'auto_last_completed',
      };
    }
  }

  return {
    module: null,
    reason: 'Не удалось определить активный модуль: нет проведённых вебинаров',
    source: 'not_found',
  };
}

/**
 * Находит первое занятие модуля по порядку.
 */
export function findFirstLessonInModule(module: CourseModuleContent): string | null {
  if (!module.lessons || module.lessons.length === 0) return null;
  const sortedLessons = [...module.lessons].sort((a, b) => a.lessonNumber - b.lessonNumber);
  return sortedLessons[0]?.sanityId ?? null;
}

/**
 * Находит первое занятие после пробного в курсе.
 */
export function findFirstPaidLesson(content: DistrictCourseContent): string | null {
  const allLessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published')
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  // Пропускаем пробные занятия
  const firstPaid = allLessons.find((l) => !l.isTrialFree);
  return firstPaid?.sanityId ?? null;
}
