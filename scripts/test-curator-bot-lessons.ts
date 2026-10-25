/**
 * npx tsx scripts/test-curator-bot-lessons.ts
 */
import {
  findLastCompletedLesson,
  findNextLessonNeedingDate,
  findNextProgramLesson,
} from '../src/lib/bot/staff/curator-bot-lessons';
import type { CuratorLessonView } from '../src/lib/curator/cabinet-data';

function lesson(
  n: number,
  status: CuratorLessonView['sessionStatus'],
  scheduledAt: string | null,
  moduleIndex = 0,
  courseLessonIndex = n,
): CuratorLessonView {
  return {
    sanityId: `id-${moduleIndex}-${n}`,
    lessonNumber: n,
    courseLessonIndex,
    title: `L${n}`,
    moduleTitle: 'M',
    moduleIndex,
    lessonDate: null,
    scheduledAt,
    liveUrl: null,
    recordingUrl: null,
    sessionStatus: status,
    startedAt: null,
    endedAt: status === 'completed' ? '2026-01-01T00:00:00Z' : null,
    materials: [],
    homeworkFiles: [],
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const lessons = [
  lesson(1, 'completed', '2026-01-01T00:00:00Z'),
  lesson(2, 'scheduled', '2026-02-01T00:00:00Z'),
  lesson(3, 'scheduled', null),
];

assert(findLastCompletedLesson(lessons)?.lessonNumber === 1, 'last completed');
assert(findNextProgramLesson(lessons)?.lessonNumber === 2, 'next program skips completed');
assert(findNextLessonNeedingDate(lessons)?.lessonNumber === 3, 'needs date = first without scheduledAt');

const twoModules = [
  ...[1, 2, 3, 4, 5, 6].map((n) =>
    lesson(n, 'completed', '2026-01-01T00:00:00Z', 0, n),
  ),
  ...[1, 2, 3, 4].map((n) =>
    lesson(n, 'completed', '2026-02-01T00:00:00Z', 1, 6 + n),
  ),
  lesson(5, 'scheduled', '2026-03-01T00:00:00Z', 1, 11),
];

assert(findLastCompletedLesson(twoModules)?.courseLessonIndex === 10, 'last = 10th overall');
assert(findNextProgramLesson(twoModules)?.courseLessonIndex === 11, 'next = 11th overall');

console.log('test-curator-bot-lessons: ok');
