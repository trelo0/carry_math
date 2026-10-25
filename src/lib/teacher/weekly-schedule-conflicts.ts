import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { dateKey, lessonEndIso } from '@/lib/teacher/schedule-utils';
import {
  bandsContain,
  resolveDayHours,
  type TeacherWorkingHoursData,
  type WeeklySlotInput,
  type WorkBand,
} from '@/lib/teacher/working-hours';
import { wallClockFromIso } from '@/lib/teacher/schedule-wall-clock';

export function weeklySlotsToAvailability(
  weekly: WeeklySlotInput[],
): TeacherWorkingHoursData['weekly'] {
  return weekly.map((slot, index) => ({
    id: -(index + 1),
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));
}

export function proposedWorkingHours(
  base: TeacherWorkingHoursData,
  weekly: WeeklySlotInput[],
): TeacherWorkingHoursData {
  return { ...base, weekly: weeklySlotsToAvailability(weekly) };
}

function lessonOutsideBands(lesson: { startsAt: string; durationMinutes: number }, bands: WorkBand[] | null): boolean {
  const startWall = wallClockFromIso(lesson.startsAt);
  const endWall = wallClockFromIso(lessonEndIso(lesson.startsAt, lesson.durationMinutes));
  if (bands == null) return true;
  if (endWall.dateKey !== startWall.dateKey) return true;
  return !bandsContain(bands, startWall.time, endWall.time);
}

export function eventsConflictingWithWeekly(
  events: ScheduleEvent[],
  workingHours: TeacherWorkingHoursData,
  weekly: WeeklySlotInput[],
  minDateKey?: string,
): ScheduleEvent[] {
  const minKey = minDateKey ?? dateKey(new Date());
  const proposed = proposedWorkingHours(workingHours, weekly);
  return events.filter((event) => {
    if (event.status !== 'scheduled' || event.kind === 'course' || event.lessonId == null) return false;
    const key = dateKey(new Date(event.startsAt));
    if (key < minKey) return false;
    const day = new Date(event.startsAt);
    const resolved = resolveDayHours(proposed, day);
    if (resolved.kind === 'off') return true;
    if (resolved.kind === 'unset') return false;
    if (resolved.kind === 'work') {
      return lessonOutsideBands(
        { startsAt: event.startsAt, durationMinutes: event.durationMinutes },
        resolved.bands,
      );
    }
    return false;
  });
}

export function lessonsConflictingWithWeekly(
  lessons: TeacherLessonView[],
  workingHours: TeacherWorkingHoursData,
  weekly: WeeklySlotInput[],
  minDateKey?: string,
): TeacherLessonView[] {
  const minKey = minDateKey ?? dateKey(new Date());
  const proposed = proposedWorkingHours(workingHours, weekly);
  return lessons.filter((lesson) => {
    if (lesson.status !== 'scheduled') return false;
    const startWall = wallClockFromIso(lesson.startsAt);
    if (startWall.dateKey < minKey) return false;
    const day = new Date(lesson.startsAt);
    const resolved = resolveDayHours(proposed, day);
    if (resolved.kind === 'off') return true;
    if (resolved.kind === 'unset') return false;
    if (resolved.kind === 'work') {
      return lessonOutsideBands(lesson, resolved.bands);
    }
    return false;
  });
}
