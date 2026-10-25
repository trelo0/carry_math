import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import type { CabinetCourseStop } from '@/lib/cabinet';

export type HomeworkRowUiState = {
  tone: 'locked' | 'todo' | 'pending' | 'done';
  label: string;
  action: 'locked' | 'submit' | 'check_status' | 'view' | 'none';
};

export function homeworkRowState(stop: CabinetCourseStop, hasCourse: boolean): HomeworkRowUiState {
  if (stop.isJoinArchive) {
    return { tone: 'done', label: 'ДЗ не требуется', action: 'none' };
  }
  const prereqLocked =
    stop.mapAccessState === 'locked_prerequisite' ||
    stop.mapAccessState === 'locked_prerequisite_past';
  if (prereqLocked) {
    return { tone: 'locked', label: 'Ожидает открытия', action: 'locked' };
  }
  const lessonLocked = stop.status === 'locked';
  if (lessonLocked) {
    return {
      tone: 'locked',
      label: hasCourse ? 'Ожидает открытия' : 'ДЗ недоступно',
      action: 'locked',
    };
  }

  const status: HomeworkProgressStatus = stop.homeworkStatus ?? 'pending';
  if (status === 'approved') {
    return { tone: 'done', label: 'Одобрено', action: 'none' };
  }
  if (status === 'submitted') {
    return { tone: 'pending', label: 'Ожидает проверки', action: 'check_status' };
  }
  if (status === 'rejected') {
    return { tone: 'pending', label: 'На доработке', action: 'view' };
  }
  if (stop.kind === 'webinar' && !stop.webinarOpened) {
    return { tone: 'locked', label: 'Посмотрите вебинар', action: 'locked' };
  }
  if (stop.isTrialFree && !hasCourse) {
    return { tone: 'locked', label: 'Сдача после покупки курса', action: 'locked' };
  }
  return { tone: 'todo', label: 'Ожидает сдачи', action: 'submit' };
}

export function homeworkLockedActionHint(label: string, stop?: CabinetCourseStop): string {
  if (label.includes('покупки')) return 'Сдача после покупки курса';
  if (label.includes('вебинар')) return 'Посмотрите вебинар';
  if (label.includes('открытия')) {
    const webinarDone =
      stop?.webinarSessionStatus === 'completed' ||
      stop?.status === 'watched' ||
      stop?.status === 'done';
    if (stop?.kind === 'webinar' && !webinarDone) {
      return 'Откроется после вебинара';
    }
    return 'После предыдущего';
  }
  return 'Откроется после вебинара';
}
