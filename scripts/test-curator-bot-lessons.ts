/**
 * npx tsx scripts/test-curator-bot-lessons.ts
 */
import {
  findLastCompletedLesson,
  findNextLessonNeedingDate,
  findNextProgramLesson,
} from '../src/lib/bot/staff/curator-bot-lessons';
import type { CuratorLessonView } from '../src/lib/curator/cabinet-data';

function lesson(n: number, status: CuratorLessonView['sessionStatus'], scheduledAt: string | null): CuratorLessonView {
  return {
    sanityId: `id-${n}`,
    lessonNumber: n,
    title: `L${n}`,
    moduleTitle: 'M',
    moduleIndex: 0,
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

console.log('test-curator-bot-lessons: ok');
