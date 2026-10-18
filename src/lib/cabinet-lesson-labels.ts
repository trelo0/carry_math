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

/** Вебинар ещё не прошёл (нет записи / эфир в будущем) — на карте показываем «Скоро». */
function isWebinarBeforeBroadcast(params: {
  lessonKind?: 'webinar' | 'practice' | 'milestone';
  webinarSessionStatus?: WebinarStatus;
  stopStatus?: 'locked' | 'now' | 'watched' | 'done' | undefined;
}): boolean {
  if (params.lessonKind !== 'webinar') return false;
  if (params.webinarSessionStatus === 'live') return false;
  const webinarDone =
    params.webinarSessionStatus === 'completed' ||
    params.stopStatus === 'watched' ||
    params.stopStatus === 'done';
  return !webinarDone;
}

/** Маркер «где сейчас идёт поток курса» (расписание группы, не личный прогресс). */
export function streamScheduleMapLabel(params: {
  webinarSessionStatus?: WebinarStatus;
  lessonKind?: 'webinar' | 'practice' | 'milestone';
}): string {
  if (params.webinarSessionStatus === 'live') return 'Идёт эфир';
  if (params.lessonKind === 'webinar') return 'Сейчас в потоке';
  return 'Сейчас в потоке';
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
  /** Текущее учебное занятие ученика на карте. */
  isCurrent?: boolean;
  /** Слот входит в оплаченный пакет (подпись на карте, не равно access). */
  inPackageQuota?: boolean;
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
  const inPaidQuota = Boolean(params.inPackageQuota);
  const coursePaidOnMap = params.hasCourse || inPaidQuota;

  if (!trialOnMap && isUnpaidPackage(params.mapAccessState) && !inPaidQuota) {
    return 'Закрыто';
  }
  if (!trialOnMap && !coursePaidOnMap) {
    return 'Закрыто';
  }

  if (params.homeworkStatus === 'approved' || params.stopStatus === 'done') {
    return 'Пройдено';
  }

  if (
    isWebinarBeforeBroadcast({
      lessonKind: params.lessonKind,
      webinarSessionStatus: params.webinarSessionStatus,
      stopStatus: params.stopStatus,
    })
  ) {
    return 'Скоро';
  }

  if (isPrerequisiteBlock(params.mapAccessState)) {
    if (!params.isFirstChainGate) {
      const webinarDone =
        params.webinarSessionStatus === 'completed' || params.stopStatus === 'watched';
      if (params.lessonKind === 'webinar' && !webinarDone) {
        return 'Скоро';
      }
      return coursePaidOnMap ? 'Ожидает' : 'Закрыто';
    }
    return coursePaidOnMap ? 'Ожидает' : 'Закрыто';
  }

  const webinarDone =
    params.webinarSessionStatus === 'completed' || params.stopStatus === 'watched';

  const isActiveLesson =
    !isPrerequisiteBlock(params.mapAccessState) &&
    (params.isCurrent || params.stopStatus === 'now' || params.mapAccessState === 'available');

  if (isActiveLesson) {
    if (params.lessonKind === 'webinar' && !webinarDone) {
      return 'Доступно';
    }
    return 'Открыто';
  }

  if (params.lessonKind === 'webinar' && !webinarDone) {
    return 'Скоро';
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

  if (!params.hasCourse) {
    return 'Занятие откроется после оплаты пакета занятий курса. Купите или продлите пакет в разделе «Оплаты».';
  }
  if (isUnpaidPackage(params.mapAccessState)) {
    return 'Занятие откроется после прохождения предыдущих занятий курса или когда откроется следующий слот пакета.';
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
