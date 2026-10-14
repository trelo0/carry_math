import type { CourseMapAccessState, HomeworkProgressStatus } from '@/lib/bot/education/course-progress';

type WebinarStatus =
  | 'scheduled'
  | 'waiting'
  | 'live'
  | 'completed'
  | 'cancelled'
  | null
  | undefined;

function isUnpaidPackage(mapAccessState?: CourseMapAccessState): boolean {
  return mapAccessState === 'locked_unpaid' || mapAccessState === 'locked_unpaid_past';
}

function isPrerequisiteBlock(mapAccessState?: CourseMapAccessState): boolean {
  return mapAccessState === 'locked_prerequisite' || mapAccessState === 'locked_prerequisite_past';
}

/** Подпись точки на карте курса. */
export function lessonMapChipLabel(params: {
  hasCourse: boolean;
  /** Пробное занятие — не входит в пакет, не показываем «Закрыто» из‑за отсутствия оплаты. */
  isTrialFree?: boolean;
  mapAccessState?: CourseMapAccessState;
  webinarSessionStatus?: WebinarStatus;
  lessonKind?: 'webinar' | 'practice' | 'milestone';
  stopStatus?: 'locked' | 'now' | 'watched' | 'done' | undefined;
  homeworkStatus?: HomeworkProgressStatus | null;
  /** Только у первого занятия в цепочке, где не пройдены предыдущие. */
  isFirstChainGate?: boolean;
  isJoinArchive?: boolean;
}): string {
  if (params.isJoinArchive) {
    const webinarDone =
      params.webinarSessionStatus === 'completed' || params.stopStatus === 'watched';
    if (params.lessonKind === 'webinar' && !webinarDone) {
      return 'Скоро';
    }
    if (
      params.mapAccessState === 'available' ||
      params.stopStatus === 'now' ||
      params.stopStatus === 'watched'
    ) {
      return 'Открыто';
    }
    return 'Скоро';
  }

  const trialOnMap = Boolean(params.isTrialFree);
  if (
    !trialOnMap &&
    (!params.hasCourse || isUnpaidPackage(params.mapAccessState))
  ) {
    return 'Закрыто';
  }

  if (params.homeworkStatus === 'approved' || params.stopStatus === 'done') {
    return 'Пройдено';
  }

  if (isPrerequisiteBlock(params.mapAccessState)) {
    if (!params.isFirstChainGate) {
      const webinarDone =
        params.webinarSessionStatus === 'completed' || params.stopStatus === 'watched';
      if (params.lessonKind === 'webinar' && !webinarDone) {
        return 'Скоро';
      }
      return 'Закрыто';
    }
    return 'Доступно';
  }

  const webinarDone =
    params.webinarSessionStatus === 'completed' || params.stopStatus === 'watched';

  if (params.lessonKind === 'webinar' && !webinarDone) {
    return 'Скоро';
  }

  if (params.mapAccessState === 'available' || params.stopStatus === 'now') {
    return 'Открыто';
  }

  if (trialOnMap) {
    return params.lessonKind === 'webinar' && !webinarDone ? 'Скоро' : 'Открыто';
  }

  return 'Закрыто';
}

/** Текст-пояснение, если карточка занятия закрыта. */
export function lessonGateMessage(params: {
  hasCourse: boolean;
  isTrialFree?: boolean;
  mapAccessState?: CourseMapAccessState;
  webinarSessionStatus?: WebinarStatus;
  lessonKind?: 'webinar' | 'practice' | 'milestone';
  isFirstChainGate?: boolean;
  isJoinArchive?: boolean;
}): string {
  if (params.isJoinArchive) {
    const webinarDone = params.webinarSessionStatus === 'completed';
    if (params.lessonKind === 'webinar' && !webinarDone) {
      return 'Будет доступно после проведения вебинара.';
    }
    return 'Архивное занятие: материалы и запись доступны для просмотра без домашнего задания.';
  }

  if (params.isTrialFree) {
    const webinarDone = params.webinarSessionStatus === 'completed';
    if (params.lessonKind === 'webinar' && !webinarDone) {
      return 'Пробное занятие доступно для прохождения. После вебинара можно сдать домашнее задание.';
    }
    return 'Пробное занятие — начните с просмотра материалов и вебинара.';
  }

  if (!params.hasCourse || isUnpaidPackage(params.mapAccessState)) {
    return 'Занятие откроется после оплаты пакета занятий курса. Купите или продлите пакет в разделе «Оплаты».';
  }

  if (isPrerequisiteBlock(params.mapAccessState)) {
    if (params.isFirstChainGate) {
      return 'Занятие откроется после того, как куратор одобрит домашнее задание по предыдущему уроку.';
    }
    const webinarDone = params.webinarSessionStatus === 'completed';
    if (params.lessonKind === 'webinar' && !webinarDone) {
      return 'Занятие откроется после прохождения вебинара и выполнения предыдущих занятий курса.';
    }
    return 'Занятие откроется после прохождения предыдущих занятий курса.';
  }

  const webinarDone = params.webinarSessionStatus === 'completed';
  if (params.lessonKind === 'webinar' && !webinarDone) {
    return 'Занятие откроется после прохождения вебинара и выполнения предыдущих занятий курса.';
  }

  return 'Занятие пока недоступно. Пройдите предыдущие шаги программы или напишите куратору.';
}
