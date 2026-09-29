import { formatLessonDateTime } from '@/lib/teacher/format';
import { findCurrentLesson } from '@/lib/teacher/lesson-utils';
import type { TeacherCabinetData, TeacherDaySlot, TeacherLessonView } from '@/lib/teacher/cabinet-data';

function recomputeTeacherDerived(data: TeacherCabinetData, allLessons: TeacherLessonView[]): TeacherCabinetData {
  const activeLessons = allLessons.filter((lesson) => lesson.status !== 'cancelled');
  const individualLessons = activeLessons.filter((lesson) => lesson.kind === 'individual');
  const groupLessons = activeLessons.filter((lesson) => lesson.kind === 'group');
  const upcoming = activeLessons
    .filter((lesson) => lesson.isUpcoming)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = Date.now();

  return {
    ...data,
    allLessons,
    individualLessons,
    groupLessons,
    nextLesson: upcoming[0] ?? null,
    currentLesson: findCurrentLesson(activeLessons, now),
  };
}

export function createOptimisticLesson(input: {
  id: number;
  kind: 'individual' | 'group';
  startsAt: string;
  durationMinutes: number;
  topic: string;
  studentTelegramId?: number | null;
  studentName?: string | null;
  groupId?: number | null;
  groupTitle?: string | null;
  lessonPlan?: string | null;
  meetUrl?: string | null;
  boardUrl?: string | null;
}): TeacherLessonView {
  const { date, time } = formatLessonDateTime(input.startsAt);
  const endMs = new Date(input.startsAt).getTime() + input.durationMinutes * 60_000;
  return {
    id: input.id,
    kind: input.kind,
    startsAt: input.startsAt,
    date,
    time,
    topic: input.topic,
    status: 'scheduled',
    studentTelegramId: input.studentTelegramId ?? null,
    studentName: input.studentName ?? null,
    groupId: input.groupId ?? null,
    groupTitle: input.groupTitle ?? null,
    meetUrl: input.meetUrl ?? null,
    boardUrl: input.boardUrl ?? null,
    lessonPlan: input.lessonPlan ?? null,
    cancelReason: null,
    durationMinutes: input.durationMinutes,
    isUpcoming: endMs > Date.now(),
  };
}

export function patchTeacherLesson(
  data: TeacherCabinetData,
  lessonId: number,
  patch: Partial<TeacherLessonView>,
): TeacherCabinetData {
  const allLessons = data.allLessons.map((lesson) => {
    if (lesson.id !== lessonId) return lesson;
    const next = { ...lesson, ...patch };
    if (patch.startsAt) {
      const { date, time } = formatLessonDateTime(patch.startsAt);
      next.date = date;
      next.time = time;
      const endMs = new Date(patch.startsAt).getTime() + next.durationMinutes * 60_000;
      next.isUpcoming = endMs > Date.now() && next.status === 'scheduled';
    }
    if (patch.status && patch.status !== 'scheduled') {
      next.isUpcoming = false;
    }
    return next;
  });
  return recomputeTeacherDerived(data, allLessons);
}

export function addTeacherLesson(data: TeacherCabinetData, lesson: TeacherLessonView): TeacherCabinetData {
  const allLessons = [...data.allLessons, lesson].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return recomputeTeacherDerived(data, allLessons);
}

export function removeTeacherDaySlot(data: TeacherCabinetData, slotId: number): TeacherCabinetData {
  return {
    ...data,
    daySlots: data.daySlots.filter((slot) => slot.id !== slotId),
  };
}

export function patchTeacherDaySlot(
  data: TeacherCabinetData,
  slotId: number,
  patch: Partial<TeacherDaySlot>,
): TeacherCabinetData {
  return {
    ...data,
    daySlots: data.daySlots.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)),
  };
}

export function addTeacherDaySlots(data: TeacherCabinetData, slots: TeacherDaySlot[]): TeacherCabinetData {
  const merged = [...data.daySlots, ...slots].sort((a, b) =>
    `${a.slotDate}${a.startTime}`.localeCompare(`${b.slotDate}${b.startTime}`),
  );
  return { ...data, daySlots: merged };
}

export function addTeacherDaySlot(data: TeacherCabinetData, slot: TeacherDaySlot): TeacherCabinetData {
  return addTeacherDaySlots(data, [slot]);
}
