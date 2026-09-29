import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { TeacherLessonDetailView } from '@/lib/teacher/lesson-detail';
import { formatLessonDateTime } from '@/lib/teacher/format';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';

export function buildOrdinaryDetailFromEvent(
  event: ScheduleEvent,
  teacherData?: TeacherCabinetData,
  materials: TeacherLessonDetailView['materials'] = [],
): TeacherLessonDetailView | null {
  const lesson = event.sourceLesson;
  if (!lesson) return null;

  const { date, time } = formatLessonDateTime(lesson.startsAt);

  if (lesson.kind === 'individual') {
    const studentTelegramId = lesson.studentTelegramId;
    const studentFromData = studentTelegramId
      ? teacherData?.students.find((item) => item.telegramId === studentTelegramId)
      : undefined;
    const student = studentTelegramId
      ? {
          telegramId: studentTelegramId,
          name: lesson.studentName ?? studentFromData?.name ?? null,
          phone: studentFromData?.phone ?? null,
        }
      : null;

    return {
      id: lesson.id,
      kind: lesson.kind,
      topic: lesson.topic,
      startsAt: lesson.startsAt,
      date,
      time,
      durationMinutes: lesson.durationMinutes,
      status: lesson.status,
      meetUrl: lesson.meetUrl,
      boardUrl: lesson.boardUrl,
      lessonPlan: lesson.lessonPlan,
      cancelReason: lesson.cancelReason,
      student,
      group: null,
      materials,
    };
  }

  const groupFromData = lesson.groupId
    ? teacherData?.groups.find((item) => item.id === lesson.groupId)
    : undefined;

  return {
    id: lesson.id,
    kind: lesson.kind,
    topic: lesson.topic,
    startsAt: lesson.startsAt,
    date,
    time,
    durationMinutes: lesson.durationMinutes,
    status: lesson.status,
    meetUrl: lesson.meetUrl,
    boardUrl: lesson.boardUrl,
    lessonPlan: lesson.lessonPlan,
    cancelReason: lesson.cancelReason,
    student: null,
    group: lesson.groupId
      ? {
          id: lesson.groupId,
          title: lesson.groupTitle ?? groupFromData?.title ?? 'Группа',
          members: (groupFromData?.members ?? []).map((member) => ({
            telegramId: member.telegramId,
            name: member.name,
            phone: null,
          })),
        }
      : null,
    materials,
  };
}
