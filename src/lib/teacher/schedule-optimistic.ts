import { formatLessonDateTime } from '@/lib/teacher/format';
import { findCurrentLesson } from '@/lib/teacher/lesson-utils';
import type {
  TeacherCabinetData,
  TeacherDaySlot,
  TeacherLessonView,
  TeacherRosterStudent,
} from '@/lib/teacher/cabinet-data';

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
  scheduleStudentId?: number | null;
  seriesId?: string | null;
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
    isPaid: false,
    scheduleStudentId: input.scheduleStudentId ?? null,
    seriesId: input.seriesId ?? null,
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

export function removeTeacherLesson(data: TeacherCabinetData, lessonId: number): TeacherCabinetData {
  const allLessons = data.allLessons.filter((lesson) => lesson.id !== lessonId);
  return recomputeTeacherDerived(data, allLessons);
}

/** Временный id до ответа API (отрицательный, не пересекается с БД). */
export function nextOptimisticLessonId(): number {
  return -Math.floor(Math.random() * 2_000_000_000) - 1;
}

export function replaceTeacherLessonId(
  data: TeacherCabinetData,
  tempId: number,
  realId: number,
  extra?: Partial<TeacherLessonView>,
): TeacherCabinetData {
  const allLessons = data.allLessons.map((lesson) => {
    if (lesson.id !== tempId) return lesson;
    return { ...lesson, ...extra, id: realId };
  });
  return recomputeTeacherDerived(data, allLessons);
}

/** После серии: убрать пропущенные слоты, подставить реальные id. */
export function reconcileSeriesLessons(
  data: TeacherCabinetData,
  tempIdByStartsAt: Map<string, number>,
  created: { id: number; startsAt: string }[],
  seriesId?: string | null,
): TeacherCabinetData {
  const createdStarts = new Set(created.map((item) => item.startsAt));
  let next = data;
  for (const [startsAt, tempId] of tempIdByStartsAt) {
    if (!createdStarts.has(startsAt)) {
      next = removeTeacherLesson(next, tempId);
      continue;
    }
    const real = created.find((item) => item.startsAt === startsAt);
    if (real) {
      next = replaceTeacherLessonId(next, tempId, real.id, seriesId ? { seriesId } : undefined);
    }
  }
  return next;
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

export function addTeacherLessons(data: TeacherCabinetData, lessons: TeacherLessonView[]): TeacherCabinetData {
  const allLessons = [...data.allLessons, ...lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return recomputeTeacherDerived(data, allLessons);
}

export function removeTeacherLessons(data: TeacherCabinetData, lessonIds: number[]): TeacherCabinetData {
  const ids = new Set(lessonIds);
  return recomputeTeacherDerived(
    data,
    data.allLessons.filter((lesson) => !ids.has(lesson.id)),
  );
}

function sortRoster(roster: TeacherRosterStudent[]): TeacherRosterStudent[] {
  return [...roster].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function upsertRosterStudent(data: TeacherCabinetData, student: TeacherRosterStudent): TeacherCabinetData {
  const exists = data.roster.some((item) => item.id === student.id);
  const roster = exists
    ? data.roster.map((item) => (item.id === student.id ? student : item))
    : [...data.roster, student];
  // Имя ученика в занятиях подтягивается из списка.
  const allLessons = data.allLessons.map((lesson) =>
    lesson.scheduleStudentId === student.id ? { ...lesson, studentName: student.name } : lesson,
  );
  return { ...data, roster: sortRoster(roster), allLessons };
}

export function removeRosterStudent(data: TeacherCabinetData, studentId: number): TeacherCabinetData {
  const archivedRoster = (data.archivedRoster ?? []).filter((item) => item.id !== studentId);
  return {
    ...data,
    roster: data.roster.filter((item) => item.id !== studentId),
    archivedRoster,
  };
}

export function removeRosterStudentCompletely(
  data: TeacherCabinetData,
  studentId: number,
  removedLessonIds: number[] = [],
): TeacherCabinetData {
  const ids = new Set(removedLessonIds);
  const base = removeRosterStudent(data, studentId);
  if (ids.size === 0) return base;
  return recomputeTeacherDerived(
    base,
    base.allLessons.filter((lesson) => !ids.has(lesson.id)),
  );
}

export function cancelLessonsByIds(
  data: TeacherCabinetData,
  lessonIds: number[],
  cancelReason: string,
): TeacherCabinetData {
  const ids = new Set(lessonIds);
  const allLessons = data.allLessons.map((lesson) =>
    ids.has(lesson.id)
      ? { ...lesson, status: 'cancelled' as const, cancelReason }
      : lesson,
  );
  return recomputeTeacherDerived(data, allLessons);
}

export function setRosterArchiveState(
  data: TeacherCabinetData,
  student: TeacherRosterStudent,
  archived: boolean,
): TeacherCabinetData {
  const next = { ...student, archivedAt: archived ? student.archivedAt ?? new Date().toISOString() : null };
  const roster = archived
    ? data.roster.filter((item) => item.id !== student.id)
    : sortRoster([...data.roster.filter((item) => item.id !== student.id), next]);
  const archivedRoster = archived
    ? sortRoster([...(data.archivedRoster ?? []).filter((item) => item.id !== student.id), next])
    : (data.archivedRoster ?? []).filter((item) => item.id !== student.id);
  return { ...data, roster, archivedRoster };
}
