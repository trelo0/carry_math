import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';

export type ScheduleEventKind = 'individual' | 'group' | 'course';
export type ScheduleEventStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type ScheduleFilter = 'all' | 'course' | 'ordinary' | 'individual' | 'group';
export type ScheduleViewMode = 'week' | 'day';

export type TeacherAvailabilitySlot = {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type ScheduleEvent = {
  id: string;
  kind: ScheduleEventKind;
  status: ScheduleEventStatus;
  title: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  participantLabel: string;
  studentTelegramId?: number;
  groupId?: number;
  lessonId?: number;
  sanityLessonId?: string;
  courseTitle?: string;
  meetUrl?: string | null;
  boardUrl?: string | null;
  lessonPlan?: string | null;
  cancelReason?: string | null;
  sourceLesson?: TeacherLessonView;
  sourceCourseLesson?: CuratorLessonView;
};

export type ScheduleFormKind = 'individual' | 'group' | 'free' | 'break' | 'busy';

export const CANCEL_REASONS = [
  { id: 'teacher', label: 'По инициативе преподавателя' },
  { id: 'student', label: 'По инициативе ученика' },
  { id: 'technical', label: 'Техническая причина' },
  { id: 'other', label: 'Другое' },
] as const;

export type CancelReasonId = (typeof CANCEL_REASONS)[number]['id'];

export type DayTimelineSegment =
  | { type: 'break'; startTime: string; endTime: string; slotId?: number }
  | { type: 'free'; startTime: string; endTime: string; slotId: number }
  | { type: 'busy'; startTime: string; endTime: string; slotId: number; label: string }
  | { type: 'lesson'; event: ScheduleEvent; startTime: string; endTime: string };
