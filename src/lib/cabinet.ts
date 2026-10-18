import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ensureDistrictCourseRecord,
  lookupCourseIdsBySlugs,
  resolveCourseIdForContent,
} from '@/lib/bot/education/course-record';
import {
  buildCourseMapStops,
  buildCourseMapStopsFromContent,
  buildCourseStructureStopsFromContent,
  isCourseProgressTableError,
  loadCourseCatalog,
  type CourseMapAccessState,
  type CourseMapStop,
  type CourseMapStopStatus,
} from '@/lib/bot/education/course-progress';
import { ACCESS_PRODUCT_LABELS } from '@/lib/bot/accesses';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import { processHomeworkDeadlinesForStudent } from '@/lib/bot/education/homework-deadline-notify';
import {
  courseLessonPackageMatchesCourse,
  coursePackageRowMatchesCourse,
  expandCourseIdAliases,
} from '@/lib/bot/education/course-access';
import {
  getCabinetPricing,
  DEFAULT_CABINET_PRICING,
  pickDailyCabinetQuote,
  type CabinetPricing,
  type CabinetQuote,
} from '@/lib/studio/cabinetSettings';
import {
  countCourseLessons,
  DEFAULT_LESSON_CONTENT_CHIPS,
  flattenCourseLessons,
  DISTRICT_COURSE_SLUG,
  getDistrictCourseContent,
  filterCourseSummariesForCabinetAccess,
  isDistrictCoursePublicInCatalog,
  listCoursePaymentOffers,
  listDistrictCourseSummaries,
  mapLessonKind,
  type CoursePaymentOffer,
  type DistrictCourseContent,
  type DistrictCourseSummary,
} from '@/lib/studio/courseContent';
import {
  computeMapAccessState,
  computeMapStopStatus,
  type CourseLessonStudentProgress,
  type HomeworkProgressStatus,
} from '@/lib/bot/education/course-progress';
import {
  computeLessonProgressPercent,
  homeworkRequiredForLesson,
  lessonHasHomework,
} from '@/lib/bot/education/lesson-progress-calc';
import {
  isCourseLessonCleared,
  previousCourseLessonsCleared,
} from '@/lib/bot/education/course-access';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import { HOMEWORK_STATUS_LABELS } from '@/lib/bot/education/course-homework';
import {
} from '@/lib/bot/purchase-requests';
import { loadMemberRoles, type BotRole } from '@/lib/bot/roles';

export function formatModulePeriodFromLessons(lessons: { lessonDate: string | null }[]): string | null {
  const dates = lessons
    .map((l) => l.lessonDate)
    .filter((d): d is string => Boolean(d))
    .map((d) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T12:00:00`);
      const dotted = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (dotted) return new Date(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]));
      return new Date(d);
    })
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!dates.length) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\./g, '');
  if (dates.length === 1) return fmt(dates[0]);
  return `${fmt(dates[0])} вЂ“ ${fmt(dates[dates.length - 1])}`;
}

// Р”Р°РЅРЅС‹Рµ Р»РёС‡РЅРѕРіРѕ РєР°Р±РёРЅРµС‚Р° СѓС‡РµРЅРёРєР°.
//
// РЎС…РµРјР° РїСЂРѕРµРєС‚Р° СЃРІСЏР·С‹РІР°РµС‚ СѓС‡РµРЅРёРєР° СЃ СѓС‡РµР±РЅС‹РјРё РґР°РЅРЅС‹РјРё С‚Р°Рє:
//   auth-РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ (С‚РµР»РµС„РѕРЅ) в†’ telegram_links в†’ telegram_id в†’
//   в†’ user_accesses / course_enrollments / groups / mentor_assignments.
//
// Р’СЃРµ С‚Р°Р±Р»РёС†С‹ Р·Р°РєСЂС‹С‚С‹ RLS (С‚РѕР»СЊРєРѕ service_role), РїРѕСЌС‚РѕРјСѓ С‡С‚РµРЅРёРµ РёРґС‘С‚
// С‡РµСЂРµР· СЃРµСЂРІРµСЂРЅС‹Р№ admin-РєР»РёРµРЅС‚. РќРёРєР°РєРёС… РЅРѕРІС‹С… С‚Р°Р±Р»РёС† РЅРµ СЃРѕР·РґР°С‘Рј:
// СЂР°Р·РґРµР»С‹ Р±РµР· РґР°РЅРЅС‹С… (Р”Р—, РїР»Р°С‚РµР¶Рё, Р¶РёР·РЅРё) РѕС‚РѕР±СЂР°Р¶Р°СЋС‚СЃСЏ РєР°Рє В«СЃРєРѕСЂРѕВ».

export type CabinetSection = 'course' | 'lessons' | 'schedule' | 'payments' | 'settings';
export type CabinetAccessProduct = 'course' | 'individual' | 'group';
export type CourseCabinetState = 'preview' | 'enrolled_locked' | 'full';

export type CabinetAccess = {
  product: CabinetAccessProduct;
  expiresAt: string | null; // null = Р±РµСЃСЃСЂРѕС‡РЅС‹Р№
};

export type CabinetEnrollment = {
  courseId: number;
  courseTitle: string;
  status: string;
  startedAt: string;
  purchaseScenario?: 'start_from_beginning' | 'join_current' | null;
};

export type CabinetCourseModulePreview = {
  name: string;
  about: string;
  count: number;
  color: string;
  period: string | null;
  lessons: { title: string; sanityId?: string | null }[];
};

export type CabinetCourseCatalog = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  cabinetEyebrow: string | null;
  deliveryFormat: string | null;
  homeworkIntro: string | null;
  coverImageUrl: string | null;
  previewImageUrl: string | null;
  previewInsideItems: { title: string; description: string | null }[];
  previewAfterEnrollment: string | null;
  previewAudience: string | null;
  sanityId: string | null;
  curatorName: string | null;
  totalLessons: number;
  /** Р§РёСЃР»Рѕ РјРѕРґСѓР»РµР№ (РґР»СЏ РїРµСЂРµРєР»СЋС‡Р°С‚РµР»СЏ; РґРµС‚Р°Р»СЊРЅС‹Р№ СЃРїРёСЃРѕРє вЂ” РІ modulePreviews). */
  modulesCount: number;
  modulePreviews: CabinetCourseModulePreview[];
};

export type CabinetMentor = {
  kind: 'teacher' | 'curator';
  name: string;
};

export type CabinetPackage = {
  id: string;
  product: CabinetAccessProduct;
  title: string;
  sub: string;
  remaining: number;
  total: number;
  active: boolean;
  courseId?: number | null;
};

export type CabinetPaymentStatus = 'paid' | 'pending' | 'rejected';

export type CabinetPayment = {
  id: string;
  date: string;
  title: string;
  price: string;
  status: CabinetPaymentStatus;
  product: CabinetAccessProduct;
  courseId?: number | null;
};

export type CabinetProfile = {
  name: string | null;
  klass: string | null;
  goal: string | null;
  resultType: 'ct' | 'grade' | null;
  resultValue: number | null;
};

export type CabinetAchievementStats = {
  liveAttendedCount: number;
  recordingWatchedCount: number;
  homeworkSubmittedCount: number;
  curatorMessagesSent: number;
};

export const EMPTY_CABINET_ACHIEVEMENT_STATS: CabinetAchievementStats = {
  liveAttendedCount: 0,
  recordingWatchedCount: 0,
  homeworkSubmittedCount: 0,
  curatorMessagesSent: 0,
};

export type CourseLessonStatus = CourseMapStopStatus;

export type CabinetCourseModule = {
  id: number;
  name: string;
  color: string;
  count: number;
  about: string;
  sortOrder: number;
};

export type CabinetCourseStop = {
  id: number;
  sanityLessonId: string | null;
  lessonId: number | null;
  module: number;
  numInModule: number;
  isCurrent: boolean;
  status: CourseLessonStatus;
  kind: 'webinar' | 'practice' | 'milestone';
  title: string;
  description: string | null;
  date: string;
  sessionStartsAt: string | null;
  liveUrl: string | null;
  recordingUrl: string | null;
  webinarSessionStatus:
    | 'scheduled'
    | 'waiting'
    | 'live'
    | 'completed'
    | 'cancelled'
    | null;
  mandatoryHomework: boolean;
  homeworkStatus: HomeworkProgressStatus | null;
  homeworkTitle: string | null;
  homeworkReviewNote: string | null;
  homeworkCompletedAt: string | null;
  homeworkDeadlineAt: string | null;
  homeworkRemainingMs: number | null;
  homeworkOverdueAt: string | null;
  /** Play live/записи — таймер и кнопка сдачи ДЗ. */
  webinarOpened: boolean;
  /** 0-100: material 60% + HW 40% */
  lessonProgressPercent: number;
  isTrialFree: boolean;
  contentChips: string[];
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  homeworkFiles: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  mapAccessState: CourseMapAccessState;
  isScheduleActive: boolean;
  isFirstChainGate: boolean;
  isJoinArchive: boolean;
  isStreamActiveModule: boolean;
  isStreamScheduleLesson: boolean;
  inPackageQuota: boolean;
};

export type CabinetLivesState = {
  current: number;
  max: number;
  accessBlocked: boolean;
  fullyBlocked: boolean;
};

export type CabinetCourseProgress = {
  lessonIndex: number;
  status: CourseLessonStatus;
};

export type CabinetData = {
  phone: string;
  createdAt: string;
  studentName: string | null;
  telegramLinked: boolean;
  /** Р”РµР№СЃС‚РІСѓСЋС‰РёРµ РїСЂРѕРґСѓРєС‚РѕРІС‹Рµ РґРѕСЃС‚СѓРїС‹. */
  accesses: CabinetAccess[];
  /** РџСЂРѕРґСѓРєС‚С‹, РєРѕС‚РѕСЂС‹Рµ РєРѕРіРґР°-Р»РёР±Рѕ РІС‹РґР°РІР°Р»РёСЃСЊ (РІРєР»СЋС‡Р°СЏ expired/cancelled). */
  accessHistory: CabinetAccessProduct[];
  enrollment: CabinetEnrollment | null;
  /** Р’СЃРµ Р°РєС‚РёРІРЅС‹Рµ Р·Р°С‡РёСЃР»РµРЅРёСЏ (РґР»СЏ РїРѕСЂСЏРґРєР° В«РјРѕРё РєСѓСЂСЃС‹В»). */
  courseEnrollments: CabinetEnrollment[];
  /** РђРєС‚РёРІРЅС‹Р№ РєСѓСЂСЃ С€РєРѕР»С‹ РґР»СЏ preview Рё Р·Р°РїРёСЃРё (РёР· courses). */
  courseCatalog: CabinetCourseCatalog | null;
  /** Р’СЃРµ РґРѕСЃС‚СѓРїРЅС‹Рµ РєСѓСЂСЃС‹ вЂ” РґР»СЏ РїРµСЂРµРєР»СЋС‡Р°С‚РµР»СЏ. */
  courseCatalogs: CabinetCourseCatalog[];
  /** РљРѕРЅС‚РµРЅС‚ Р°РєС‚РёРІРЅРѕРіРѕ РєСѓСЂСЃР° РёР· Sanity (СЃС‚СЂСѓРєС‚СѓСЂР° РјРѕРґСѓР»РµР№/СѓСЂРѕРєРѕРІ). */
  courseContent: DistrictCourseContent | null;
  /** Р¦РёС‚Р°С‚Р° РґРЅСЏ РґР»СЏ Р±РѕРєРѕРІРѕР№ РїР°РЅРµР»Рё. */
  dailyQuote: CabinetQuote;
  mentors: CabinetMentor[];
  /** Ind/group: Р±С‹Р»Рё Р·Р°РЅСЏС‚РёСЏ РІ scheduled_lessons (РґР»СЏ gate Р±РµР· РїРѕР»РЅРѕР№ Р·Р°РіСЂСѓР·РєРё lessons). */
  hasOrdinaryStudentTrack: boolean;
  packages: CabinetPackage[];
  payments: CabinetPayment[];
  profile: CabinetProfile | null;
  courseProgress: CabinetCourseProgress[];
  courseModules: CabinetCourseModule[];
  courseStops: CabinetCourseStop[];
  lives: CabinetLivesState | null;
  /** Р¦РµРЅС‹ РїР°РєРµС‚РѕРІ РєСѓСЂСЃР° / РёРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹С… / РіСЂСѓРїРїРѕРІС‹С… РёР· Sanity. */
  cabinetPricing: CabinetPricing;
  /** РљР°СЂС‚РѕС‡РєРё РѕРїР»Р°С‚С‹ РєСѓСЂСЃРѕРІ (С†РµРЅР° + N Р·Р°РЅСЏС‚РёР№ РёР· РЅР°СЃС‚СЂРѕРµРє РєР°Р¶РґРѕРіРѕ РєСѓСЂСЃР°). */
  coursePaymentOffers: CoursePaymentOffer[];
  /** РќР°Р¶Р°Р» В«РџРѕСЃРјРѕС‚СЂРµС‚СЊ РєР°СЂС‚Сѓ РєСѓСЂСЃР°В» РІ РїСЂРµРІСЊСЋ (student_profiles.course_map_viewed_at). */
  courseMapViewed: boolean;
  /** Р’СЃРµ СЂРѕР»Рё СѓС‡Р°СЃС‚РЅРёРєР°: РѕСЃРЅРѕРІРЅР°СЏ + extra_roles. */
  memberRoles: BotRole[];
  /** Агрегаты для достижений (эфир, запись, ДЗ, сообщения куратору). */
  achievementStats: CabinetAchievementStats;
  /** Telegram ID при успешной привязке (для UI без повторного запроса). */
  telegramId: number | null;
  /** false — прогресс карты догружается на клиенте (/api/cabinet/course-map). */
  courseMapProgressLoaded: boolean;
};

export type GetCabinetDataOptions = {
  /** Полная карта с прогрессом на сервере (checkout). Для /cabinet — false. */
  loadMapProgress?: boolean;
  /** Платежи и достижения подгрузятся при открытии разделов / refresh. */
  deferSecondaryData?: boolean;
  /** Не ждать ensure курсов и resetCourseWhenNoPaidPackages на SSR. */
  deferHeavyMaintenance?: boolean;
};

export function hasActiveAccess(data: CabinetData, product: CabinetAccessProduct): boolean {
  if (data.accesses.some((a) => a.product === product)) return true;
  if (product === 'course') return hasCoursePayment(data);
  if (data.packages.some((p) => p.product === product && p.active)) return true;
  return false;
}

export function hadAccess(data: CabinetData, product: CabinetAccessProduct): boolean {
  if (data.accessHistory.includes(product)) return true;
  if (hasActiveAccess(data, product)) return true;
  if (data.packages.some((p) => p.product === product && p.total > 0)) return true;
  if (product === 'course') {
    return data.packages.some((p) => p.product === 'course' && p.total > 0) || data.enrollment != null;
  }
  if (product === 'individual' || product === 'group') {
    return data.hasOrdinaryStudentTrack;
  }
  return false;
}

export function hadAnyLessonsProduct(data: CabinetData): boolean {
  if (data.accessHistory.includes('individual') || data.accessHistory.includes('group')) return true;
  if (data.accesses.some((a) => a.product === 'individual' || a.product === 'group')) return true;
  if (data.packages.some((p) => (p.product === 'individual' || p.product === 'group') && p.total > 0)) {
    return true;
  }
  return data.hasOrdinaryStudentTrack;
}

/** Оплата курса: есть пакет занятий course (строка в lesson_packages). */
export function hasCoursePayment(data: Pick<CabinetData, 'accesses' | 'packages'>): boolean {
  return data.packages.some((p) => p.product === 'course' && p.total > 0);
}

/** Оплата конкретного курса (пакет с course_id; legacy null — только основной slug). */
export function hasCoursePaymentForCourse(
  packages: Pick<CabinetPackage, 'product' | 'total' | 'courseId' | 'title'>[],
  courseId: number,
  courseSlug?: string | null,
  courseTitle?: string | null,
  aliasCourseIds?: number[],
): boolean {
  const aliasIds = new Set([courseId, ...(aliasCourseIds ?? [])]);
  return packages.some((p) => {
    if (p.product !== 'course' || p.total <= 0) return false;
    if (p.courseId != null && aliasIds.has(p.courseId)) return true;
    return courseLessonPackageMatchesCourse(p.courseId, p.title, courseId, courseSlug, courseTitle);
  });
}

export function getCourseCabinetStateForCourse(
  data: Pick<CabinetData, 'courseMapViewed' | 'packages' | 'accesses'>,
  courseId: number,
  courseSlug?: string | null,
  courseTitle?: string | null,
  aliasCourseIds?: number[],
): CourseCabinetState {
  if (!hasViewedCourseMap(data)) return 'preview';
  if (
    !hasCoursePaymentForCourse(
      data.packages,
      courseId,
      courseSlug,
      courseTitle,
      aliasCourseIds,
    )
  ) {
    return 'enrolled_locked';
  }
  return 'full';
}

/** Контент занятия в кабинете — только при реальном access, не по «квоте в пакете». */
export function resolveMapHasCourseProductAccess(
  packages: Pick<CabinetPackage, 'product' | 'total' | 'courseId' | 'title'>[],
  courseId: number | null | undefined,
  courseSlug?: string | null,
  courseTitle?: string | null,
  aliasCourseIds?: number[],
): boolean {
  if (
    courseId != null &&
    hasCoursePaymentForCourse(packages, courseId, courseSlug, courseTitle, aliasCourseIds)
  ) {
    return true;
  }
  return packages.some((p) => p.product === 'course' && p.total > 0);
}

export function isCabinetLessonContentOpen(
  stop: Pick<CabinetCourseStop, 'mapAccessState' | 'isTrialFree'>,
  courseState: CourseCabinetState,
): boolean {
  if (stop.mapAccessState === 'available' || stop.mapAccessState === 'completed') return true;
  if (stop.isTrialFree && courseState !== 'preview') return true;
  return false;
}

/** РџСЂРµРІСЊСЋ СЃРєСЂС‹РІР°РµС‚СЃСЏ РїРѕСЃР»Рµ РєР»РёРєР° В«РџРѕСЃРјРѕС‚СЂРµС‚СЊ РєР°СЂС‚СѓВ» РёР»Рё РµСЃР»Рё РєСѓСЂСЃ СѓР¶Рµ РѕРїР»Р°С‡РµРЅ. */
export function hasViewedCourseMap(data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages'>): boolean {
  return data.courseMapViewed || hasCoursePayment(data);
}

/** preview вЂ” РїРµСЂРІС‹Р№ РІРёР·РёС‚; enrolled_locked вЂ” РєР°СЂС‚Р° Р±РµР· РѕРїР»Р°С‚С‹; full вЂ” РµСЃС‚СЊ РѕРїР»Р°С‚Р° РєСѓСЂСЃР°. */
export function getCourseCabinetState(
  data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages'>,
): CourseCabinetState {
  if (!hasViewedCourseMap(data)) return 'preview';
  if (!hasCoursePayment(data)) return 'enrolled_locked';
  return 'full';
}

/** В«Р—Р°РїРёСЃР°РЅ РЅР° РєСѓСЂСЃВ» = РѕРїР»Р°С‚РёР» (РµСЃС‚СЊ РїР°РєРµС‚ / РґРѕСЃС‚СѓРї), РЅРµ РєР»РёРє РїРѕ РїСЂРµРІСЊСЋ. */
export function isEnrolledOnCourse(data: Pick<CabinetData, 'accesses' | 'packages'>): boolean {
  return hasCoursePayment(data);
}

/** РљСѓСЂР°С‚РѕСЂ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РїСЂРё РїРѕР»РЅРѕРј РґРѕСЃС‚СѓРїРµ РёР»Рё РїСЂРё 0 Р¶РёР·РЅСЏС…. */
export function shouldShowCourseCurator(data: CabinetData): boolean {
  const state = getCourseCabinetState(data);
  if (state === 'full') return !!data.mentors.find((m) => m.kind === 'curator');
  if (data.lives?.accessBlocked) return !!data.mentors.find((m) => m.kind === 'curator');
  return false;
}

/** Р’ Sanity/Supabase РµСЃС‚СЊ РїСЂРµРґР»РѕР¶РµРЅРёРµ РѕРЅР»Р°Р№РЅ-РєСѓСЂСЃР° РґР»СЏ РєР°Р±РёРЅРµС‚Р°. */
export function hasCourseCatalogOffer(data: Pick<CabinetData, 'courseCatalog' | 'courseContent'>): boolean {
  if (data.courseCatalog) return true;
  return (data.courseContent?.modules.length ?? 0) > 0;
}

/** РЈС‡РµРЅРёРє РЅР°С‡Р°Р» РїСѓС‚СЊ РѕРЅР»Р°Р№РЅ-РєСѓСЂСЃР° (Р·Р°РїРёСЃСЊ, РѕРїР»Р°С‚Р° РёР»Рё РѕС‚РєСЂС‹С‚РёРµ РєР°СЂС‚С‹). */
export function hasStartedCourseCabinetTrack(
  data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages' | 'enrollment'>,
): boolean {
  if (data.enrollment != null) return true;
  if (hasCoursePayment(data)) return true;
  return data.courseMapViewed;
}

/**
 * Р­РєСЂР°РЅ В«РєР°Р±РёРЅРµС‚ С‚РѕР»СЊРєРѕ РґР»СЏ РєСѓСЂСЃР°В»: ind/group Р±РµР· РѕРЅР»Р°Р№РЅ-РєСѓСЂСЃР°
 * РёР»Рё РЅРµС‚ РґР°РЅРЅС‹С… РєР°С‚Р°Р»РѕРіР° вЂ” РЅРµ РїРѕРєР°Р·С‹РІР°РµРј РєР°СЂС‚Сѓ/РїСЂРµРІСЊСЋ.
 */
export function shouldShowCourseCabinetGate(data: CabinetData): boolean {
  if (!hasCourseCatalogOffer(data)) return true;
  if (hasStartedCourseCabinetTrack(data)) return false;
  return hadAnyLessonsProduct(data);
}

const ACTIVE = 'active';

function isNotExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

function isStaffMessagesTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('staff_student_messages');
}

async function loadAchievementStats(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<CabinetAchievementStats> {
  const stats: CabinetAchievementStats = { ...EMPTY_CABINET_ACHIEVEMENT_STATS };

  try {
    const { data, error } = await admin
      .from('course_lesson_student_progress')
      .select('live_attended_at, recording_watched_at, homework_status')
      .eq('telegram_id', telegramId);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.live_attended_at) stats.liveAttendedCount += 1;
      if (row.recording_watched_at) stats.recordingWatchedCount += 1;
      const hs = row.homework_status as string | null;
      if (hs === 'submitted' || hs === 'approved' || hs === 'rejected') {
        stats.homeworkSubmittedCount += 1;
      }
    }
  } catch (error) {
    if (!isCourseProgressTableError(error) && !isCabinetTableError(error)) throw error;
  }

  try {
    const { count, error } = await admin
      .from('staff_student_messages')
      .select('id', { count: 'exact', head: true })
      .eq('student_telegram_id', telegramId)
      .eq('staff_role', 'curator')
      .eq('direction', 'student_to_staff');
    if (error) throw error;
    stats.curatorMessagesSent = count ?? 0;
  } catch (error) {
    if (!isStaffMessagesTableError(error) && !isCabinetTableError(error)) throw error;
  }

  return stats;
}

function isCabinetTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('does not exist') ||
    message.includes('Could not find') ||
    message.includes('schema cache')
  );
}

function isSupabaseTransientError(error: unknown): boolean {
  const details = error as { message?: unknown; details?: unknown } | null;
  const blob = `${String(details?.message ?? error)} ${String(details?.details ?? '')}`;
  return (
    blob.includes('fetch failed') ||
    blob.includes('ConnectTimeout') ||
    blob.includes('ECONNRESET') ||
    blob.includes('ETIMEDOUT') ||
    blob.includes('network')
  );
}

function isDegradedCabinetLoadError(error: unknown): boolean {
  return isCabinetTableError(error) || isSupabaseTransientError(error);
}

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const PRODUCT_LABELS: Record<CabinetAccessProduct, string> = {
  course: ACCESS_PRODUCT_LABELS.course,
  individual: ACCESS_PRODUCT_LABELS.individual,
  group: ACCESS_PRODUCT_LABELS.group,
};

function mergeAccessHistoryFromPurchases(
  history: CabinetAccessProduct[],
  packages: CabinetPackage[],
): CabinetAccessProduct[] {
  const set = new Set(history);
  for (const pkg of packages) {
    if (pkg.total > 0) set.add(pkg.product);
  }
  return [...set];
}

async function loadHasOrdinaryStudentTrack(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<boolean> {
  const { count, error } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .in('kind', ['individual', 'group'])
    .neq('status', 'cancelled');
  if (error) {
    if (isDegradedCabinetLoadError(error)) return false;
    throw error;
  }
  return (count ?? 0) > 0;
}

async function loadPackages(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<CabinetPackage[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, product, title, total_lessons, used_lessons, remaining_lessons, status, course_id')
    .eq('telegram_id', telegramId)
    .order('purchased_at', { ascending: false });
  if (error) {
    if (isDegradedCabinetLoadError(error)) return [];
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    product: row.product as CabinetAccessProduct,
    title: row.title,
    sub: PRODUCT_LABELS[row.product as CabinetAccessProduct] ?? row.title,
    remaining: row.remaining_lessons,
    total: row.total_lessons,
    active: row.status === 'active' && row.remaining_lessons > 0,
    courseId: (row.course_id as number | null | undefined) ?? null,
  }));
}

function paymentDisplayTitle(
  product: CabinetAccessProduct,
  courseTitle: string | null | undefined,
  packageTitle: string | null | undefined,
): string {
  if (product === 'course' && courseTitle?.trim()) return courseTitle.trim();
  const fromPackage = packageTitle?.trim();
  if (fromPackage) return fromPackage;
  return PRODUCT_LABELS[product] ?? product;
}

async function loadPayments(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<CabinetPayment[]> {
  const { data: paidRows, error: paidError } = await admin
    .from('payments')
    .select('id, product, amount_byn, paid_at, package_id, lesson_packages ( title, course_id )')
    .eq('telegram_id', telegramId)
    .order('paid_at', { ascending: false })
    .limit(50);
  if (paidError) throw paidError;

  const courseIds = new Set<number>();
  for (const row of paidRows ?? []) {
    const pkgJoin = row.lesson_packages as { course_id?: number | null } | { course_id?: number | null }[] | null;
    const cid = Array.isArray(pkgJoin) ? pkgJoin[0]?.course_id : pkgJoin?.course_id;
    if (typeof cid === 'number') courseIds.add(cid);
  }
  const courseTitleById = new Map<number, string>();
  if (courseIds.size > 0) {
    const { data: courseRows } = await admin
      .from('courses')
      .select('id, title')
      .in('id', [...courseIds]);
    for (const c of courseRows ?? []) {
      courseTitleById.set(c.id as number, c.title as string);
    }
  }

  const paid: CabinetPayment[] = (paidRows ?? []).map((row) => {
    const pkgJoin = row.lesson_packages as
      | { title?: string; course_id?: number | null }
      | { title?: string; course_id?: number | null }[]
      | null;
    const pkg = Array.isArray(pkgJoin) ? pkgJoin[0] : pkgJoin;
    const packageTitle = pkg?.title;
    const courseId = typeof pkg?.course_id === 'number' ? pkg.course_id : null;
    const product = row.product as CabinetAccessProduct;
    const courseTitle = courseId != null ? courseTitleById.get(courseId) : null;
    return {
      id: `pay-${row.id}`,
      date: formatPaymentDate(row.paid_at),
      title: paymentDisplayTitle(product, courseTitle, packageTitle),
      price: String(row.amount_byn),
      status: 'paid' as const,
      product,
      courseId,
    };
  });

  return paid;
}

type LoadedProfile = {
  profile: CabinetProfile | null;
  courseMapViewed: boolean;
};

async function loadProfile(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<LoadedProfile> {
  const { data, error } = await admin
    .from('student_profiles')
    .select('display_name, school_class, goal, result_type, result_value, course_map_viewed_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) {
    const message = String((error as { message?: string }).message ?? error);
    if (message.includes('course_map_viewed_at')) {
      const fallback = await admin
        .from('student_profiles')
        .select('display_name, school_class, goal, result_type, result_value')
        .eq('telegram_id', telegramId)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (!fallback.data) return { profile: null, courseMapViewed: false };
      return {
        profile: {
          name: fallback.data.display_name ?? null,
          klass: fallback.data.school_class ?? null,
          goal: fallback.data.goal ?? null,
          resultType: (fallback.data.result_type as 'ct' | 'grade' | null) ?? null,
          resultValue: fallback.data.result_value ?? null,
        },
        courseMapViewed: false,
      };
    }
    throw error;
  }
  if (!data) return { profile: null, courseMapViewed: false };

  return {
    profile: {
      name: data.display_name ?? null,
      klass: data.school_class ?? null,
      goal: data.goal ?? null,
      resultType: (data.result_type as 'ct' | 'grade' | null) ?? null,
      resultValue: data.result_value ?? null,
    },
    courseMapViewed: Boolean(data.course_map_viewed_at),
  };
}

function formatSessionDate(iso: string | null): string {
  if (!iso) return 'Уточняется';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function mapStopToCabinet(stop: CourseMapStop): CabinetCourseStop {
  return {
    id: stop.lessonIndex + 1,
    sanityLessonId: stop.sanityLessonId,
    lessonId: stop.lessonId,
    module: stop.moduleIndex,
    numInModule: stop.numInModule,
    isCurrent: stop.isCurrent,
    status: stop.status,
    kind: stop.kind,
    title: stop.title,
    description: stop.description,
    date: formatSessionDate(stop.sessionStartsAt),
    sessionStartsAt: stop.sessionStartsAt,
    liveUrl: stop.liveUrl,
    recordingUrl: stop.recordingUrl,
    webinarSessionStatus: stop.sessionStatus,
    mandatoryHomework: stop.mandatoryHomework,
    homeworkStatus: stop.homeworkStatus,
    homeworkTitle: stop.homeworkTitle,
    homeworkReviewNote: stop.homeworkReviewNote,
    homeworkCompletedAt: stop.homeworkCompletedAt,
    homeworkDeadlineAt: stop.homeworkDeadlineAt,
    homeworkRemainingMs: stop.homeworkRemainingMs,
    homeworkOverdueAt: stop.homeworkOverdueAt,
    webinarOpened: stop.webinarOpened,
    lessonProgressPercent: stop.lessonProgressPercent,
    isTrialFree: stop.isTrialFree,
    contentChips: stop.contentChips,
    materials: stop.materials,
    homeworkFiles: stop.homeworkFiles,
    mapAccessState: stop.mapAccessState,
    isScheduleActive: stop.isScheduleActive,
    isFirstChainGate: stop.isFirstChainGate,
    isJoinArchive: stop.isJoinArchive,
    isStreamActiveModule: stop.isStreamActiveModule,
    isStreamScheduleLesson: stop.isStreamScheduleLesson,
    inPackageQuota: stop.inPackageQuota,
  };
}

export function mapContentToCourseModules(content: DistrictCourseContent): CabinetCourseModule[] {
  return content.modules.map((m, i) => {
    const visibleCount = m.lessons.filter((l) => l.publicationStatus !== 'archived').length;
    return {
      id: i,
      name: m.title,
      color: m.color,
      count: visibleCount > 0 ? visibleCount : m.lessons.length,
      about: m.description ?? '',
      sortOrder: m.sortOrder,
    };
  });
}

export function mapContentToStructureStops(content: DistrictCourseContent): CabinetCourseStop[] {
  return buildCourseStructureStopsFromContent(content).map(mapStopToCabinet);
}

/** Fallback РєР°СЂС‚С‹ РёР· preview-РјРѕРґСѓР»РµР№ РєР°С‚Р°Р»РѕРіР°, РµСЃР»Рё Sanity-СѓСЂРѕРєРё РЅРµРґРѕСЃС‚СѓРїРЅС‹. */
export function buildModulePreviewsFromContent(
  courseContent: DistrictCourseContent | null,
): CabinetCourseModulePreview[] {
  if (!courseContent) return [];
  return courseContent.modules.map((m) => {
    const visibleLessons = m.lessons.filter((l) => l.publicationStatus === 'published');
    return {
      name: m.title,
      about: m.description ?? '',
      count: visibleLessons.length,
      color: m.color,
      period: formatModulePeriodFromLessons(m.lessons),
      lessons: visibleLessons.map((l) => ({ title: l.title, sanityId: l.sanityId })),
    };
  });
}

/** URL СЃС‚СЂР°РЅРёС†С‹ Р·Р°РЅСЏС‚РёСЏ вЂ” Sanity ID РёР»Рё РїРѕСЂСЏРґРєРѕРІС‹Р№ РЅРѕРјРµСЂ РЅР° РєР°СЂС‚Рµ. */
export function lessonPathForStop(
  stop: Pick<CabinetCourseStop, 'sanityLessonId' | 'id'>,
  courseSlug?: string | null,
): string {
  const base = `/cabinet/lesson/${encodeURIComponent(stop.sanityLessonId ?? String(stop.id))}`;
  const slug = courseSlug?.trim();
  if (!slug) return base;
  return `${base}?course=${encodeURIComponent(slug)}`;
}

export function findCabinetStopByLessonParam(
  stops: CabinetCourseStop[],
  lessonParam: string,
): CabinetCourseStop | undefined {
  const key = decodeURIComponent(lessonParam).trim();
  return (
    stops.find((s) => s.sanityLessonId === key) ??
    stops.find((s) => String(s.id) === key) ??
    stops.find((s) => s.lessonId != null && String(s.lessonId) === key)
  );
}

export function buildStopsFromCatalogPreviews(catalog: CabinetCourseCatalog | null): CabinetCourseStop[] {
  if (!catalog?.modulePreviews?.length) return [];
  const stops: CabinetCourseStop[] = [];
  let lessonIndex = 0;
  catalog.modulePreviews.forEach((mod, moduleIndex) => {
    const lessonTitles: CabinetCourseModulePreview['lessons'] =
      mod.lessons.length > 0
        ? mod.lessons
        : Array.from({ length: Math.max(mod.count, 1) }, (_, i) => ({ title: `Р—Р°РЅСЏС‚РёРµ ${i + 1}` }));
    lessonTitles.forEach((lesson, numInModuleIndex) => {
      stops.push({
        id: lessonIndex + 1,
        sanityLessonId: lesson.sanityId ?? null,
        lessonId: null,
        module: moduleIndex,
        numInModule: numInModuleIndex + 1,
        isCurrent: false,
        status: 'locked',
        kind: 'webinar',
        title: lesson.title,
        description: mod.about || null,
        date: mod.period ?? 'вЂ”',
        sessionStartsAt: null,
        liveUrl: null,
        recordingUrl: null,
        webinarSessionStatus: null,
        mandatoryHomework: false,
        homeworkStatus: null,
        homeworkTitle: null,
        homeworkReviewNote: null,
        homeworkCompletedAt: null,
        homeworkDeadlineAt: null,
        homeworkRemainingMs: null,
        homeworkOverdueAt: null,
        webinarOpened: false,
        lessonProgressPercent: 0,
        isTrialFree: false,
        contentChips: [],
        materials: [],
        homeworkFiles: [],
        mapAccessState: 'locked_unpaid',
        isScheduleActive: false,
        isFirstChainGate: false,
        isJoinArchive: false,
        isStreamActiveModule: false,
        isStreamScheduleLesson: false,
        inPackageQuota: false,
      });
      lessonIndex += 1;
    });
  });
  return stops;
}

export function buildModulesFromCatalogPreviews(
  catalog: CabinetCourseCatalog | null,
): CabinetCourseModule[] {
  if (!catalog?.modulePreviews?.length) return [];
  return catalog.modulePreviews.map((mod, index) => ({
    id: index,
    name: mod.name,
    color: mod.color,
    count: mod.lessons.length > 0 ? mod.lessons.length : mod.count,
    about: mod.about,
    sortOrder: index,
  }));
}

async function resolveCourseMapFromContent(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
  courseId: number | null,
  content: DistrictCourseContent,
  options: {
    courseState: CourseCabinetState;
    hasCourseProductAccess: boolean;
    withProgress: boolean;
  },
): Promise<{
  modules: CabinetCourseModule[];
  stops: CabinetCourseStop[];
  progress: CabinetCourseProgress[];
}> {
  const modules = mapContentToCourseModules(content);

  if (options.withProgress && courseId) {
    const livesState = await getEnrollmentLives(admin, telegramId, courseId);
    const accessBlocked = livesState?.access_blocked ?? false;
    const fullyBlocked = livesState?.fully_blocked ?? false;
    const shouldSyncAccess =
      options.hasCourseProductAccess && !accessBlocked && !fullyBlocked;

    if (shouldSyncAccess) {
      try {
        const { ensureTrialHomeworkDeadlineIfEligible } = await import(
          '@/lib/bot/education/homework-deadline'
        );
        await ensureTrialHomeworkDeadlineIfEligible(admin, telegramId, content, courseId);
      } catch (error) {
        if (!isCourseProgressTableError(error)) {
          console.error('[cabinet] trial homework deadline sync failed:', error);
        }
      }
    }

    const mapStops = await buildCourseMapStopsFromContent(admin, telegramId, content, accessBlocked, {
      courseState: options.courseState,
      hasCourseProductAccess: options.hasCourseProductAccess,
      fullyBlocked,
      courseId,
    });

    if (shouldSyncAccess) {
      void (async () => {
        try {
          const { syncJoinCurrentEnrollmentAccess } = await import(
            '@/lib/bot/education/course-access'
          );
          await syncJoinCurrentEnrollmentAccess(admin, telegramId, courseId, content, null);
        } catch (error) {
          if (!isCourseProgressTableError(error)) {
            console.error('[cabinet] background access sync failed:', error);
          }
        }
      })();
    }
    return {
      modules,
      stops: mapStops.map(mapStopToCabinet),
      progress: mapStops.map((s) => ({ lessonIndex: s.lessonIndex, status: s.status })),
    };
  }

  const structureStops = buildCourseStructureStopsFromContent(content);
  return {
    modules,
    stops: structureStops.map(mapStopToCabinet),
    progress: [],
  };
}

async function loadCourseMapData(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
  courseId: number | null,
  content: DistrictCourseContent | null,
  options: {
    courseState: CourseCabinetState;
    hasCourseProductAccess: boolean;
  },
): Promise<{
  modules: CabinetCourseModule[];
  stops: CabinetCourseStop[];
  progress: CabinetCourseProgress[];
}> {
  if (!courseId) return { modules: [], stops: [], progress: [] };

  if (content && content.modules.length > 0) {
    return resolveCourseMapFromContent(admin, telegramId, courseId, content, {
      courseState: options.courseState,
      hasCourseProductAccess: options.hasCourseProductAccess,
      withProgress: true,
    });
  }

  const livesState = await getEnrollmentLives(admin, telegramId, courseId);
  const accessBlocked = livesState?.access_blocked ?? false;
  const mapStops = await buildCourseMapStops(admin, telegramId, courseId, accessBlocked);
  const { modules } = await loadCourseCatalog(admin, courseId);
  const cabinetModules = modules.map((m) => ({
    id: m.id,
    name: m.title,
    color: m.color,
    count: m.lesson_count,
    about: m.about ?? '',
    sortOrder: m.sort_order,
  }));

  return {
    modules: cabinetModules,
    stops: mapStops.map(mapStopToCabinet),
    progress: mapStops.map((s) => ({ lessonIndex: s.lessonIndex, status: s.status })),
  };
}

function catalogFromSummary(
  summary: DistrictCourseSummary,
  courseId: number,
): CabinetCourseCatalog {
  return {
    id: courseId,
    title: summary.title,
    slug: summary.slug,
    description: summary.description?.trim() || null,
    cabinetEyebrow: summary.cabinetEyebrow,
    deliveryFormat: summary.deliveryFormat,
    homeworkIntro: summary.homeworkIntro,
    coverImageUrl: summary.coverImageUrl,
    previewImageUrl: summary.previewImageUrl,
    previewInsideItems: summary.previewInsideItems,
    previewAfterEnrollment: summary.previewAfterEnrollment,
    previewAudience: summary.previewAudience,
    sanityId: summary.sanityId,
    curatorName: summary.curatorName,
    totalLessons:
      summary.totalLessons ||
      summary.modulePreviews.reduce((sum, m) => sum + m.count, 0),
    modulesCount:
      summary.moduleCount ||
      summary.modulePreviews.length ||
      0,
    modulePreviews: summary.modulePreviews.map((m) => ({
      name: m.name,
      about: m.about,
      count: m.count,
      color: m.color,
      period: m.period,
      lessons: m.lessons,
    })),
  };
}

export async function getCabinetData(
  phone: string,
  createdAt: string,
  preferredCourseSlug?: string | null,
  options?: GetCabinetDataOptions,
): Promise<CabinetData> {
  const loadMapProgress = options?.loadMapProgress !== false;
  const deferSecondaryData = options?.deferSecondaryData === true;
  const deferHeavyMaintenance =
    options?.deferHeavyMaintenance === true || deferSecondaryData;
  const empty: CabinetData = {
    phone,
    createdAt,
    studentName: null,
    telegramLinked: false,
    accesses: [],
    accessHistory: [],
    enrollment: null,
    courseEnrollments: [],
    courseCatalog: null,
    courseCatalogs: [],
    courseContent: null,
    dailyQuote: pickDailyCabinetQuote(DEFAULT_CABINET_PRICING.quotes),
    mentors: [],
    hasOrdinaryStudentTrack: false,
    packages: [],
    payments: [],
    profile: null,
    courseProgress: [],
    courseModules: [],
    courseStops: [],
    lives: null,
    cabinetPricing: DEFAULT_CABINET_PRICING,
    coursePaymentOffers: [],
    courseMapViewed: false,
    memberRoles: ['guest'],
    achievementStats: EMPTY_CABINET_ACHIEVEMENT_STATS,
    telegramId: null,
    courseMapProgressLoaded: true,
  };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Supabase service role РЅРµ РЅР°СЃС‚СЂРѕРµРЅ вЂ” РЅРµ СЂРѕРЅСЏРµРј РєР°Р±РёРЅРµС‚.
    return empty;
  }

  // РџСЂРёРІСЏР·РєР° С‚РµР»РµС„РѕРЅР° Рє Telegram.
  const { data: link, error: linkError } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (linkError) {
    if (isSupabaseTransientError(linkError)) {
      throw new Error(
        'Не удалось связаться с сервером. Проверьте интернет и обновите страницу.',
      );
    }
    return empty;
  }
  if (!link?.telegram_id) return empty;
  const telegramId = link.telegram_id as number;

  type EnrollmentRow = {
    status: string;
    started_at: string;
    course_id: number;
    purchase_scenario?: 'start_from_beginning' | 'join_current' | null;
    courses: { title?: string; slug?: string } | { title?: string; slug?: string }[] | null;
  };

  const loadMemberBlock = async (): Promise<{ memberRoles: BotRole[]; studentName: string | null }> => {
    try {
      if (deferSecondaryData) {
        const { data: member } = await admin
          .from('bot_members')
          .select('full_name')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        return { memberRoles: ['guest'] as BotRole[], studentName: member?.full_name ?? null };
      }
      const roles = await loadMemberRoles(admin, telegramId);
      const { data: member } = await admin
        .from('bot_members')
        .select('full_name')
        .eq('telegram_id', telegramId)
        .maybeSingle();
      return { memberRoles: roles, studentName: member?.full_name ?? null };
    } catch (error) {
      if (!isDegradedCabinetLoadError(error)) throw error;
      return { memberRoles: ['guest'] as BotRole[], studentName: null };
    }
  };

  const loadSanityBlock = async (): Promise<{
    cabinetPricing: CabinetPricing;
    coursePaymentOffers: CoursePaymentOffer[];
    courseSummaries: DistrictCourseSummary[];
  }> => {
    let cabinetPricing: CabinetPricing = DEFAULT_CABINET_PRICING;
    let coursePaymentOffers: CoursePaymentOffer[] = [];
    let courseSummaries: DistrictCourseSummary[] = [];
    if (deferSecondaryData) {
      try {
        [courseSummaries, coursePaymentOffers] = await Promise.all([
          listDistrictCourseSummaries(),
          listCoursePaymentOffers(),
        ]);
      } catch (error) {
        console.error('[cabinet] Sanity summaries/offers fetch failed:', error);
        courseSummaries = [];
        coursePaymentOffers = [];
        try {
          courseSummaries = await listDistrictCourseSummaries();
        } catch {
          courseSummaries = [];
        }
        try {
          coursePaymentOffers = await listCoursePaymentOffers();
        } catch {
          coursePaymentOffers = [];
        }
      }
      return { cabinetPricing, coursePaymentOffers, courseSummaries };
    }
    try {
      [cabinetPricing, coursePaymentOffers, courseSummaries] = await Promise.all([
        getCabinetPricing(),
        listCoursePaymentOffers(),
        listDistrictCourseSummaries(),
      ]);
    } catch (error) {
      console.error('[cabinet] Sanity fetch failed:', error);
      coursePaymentOffers = [];
      courseSummaries = [];
      try {
        cabinetPricing = await getCabinetPricing();
      } catch {
        cabinetPricing = DEFAULT_CABINET_PRICING;
      }
      try {
        coursePaymentOffers = await listCoursePaymentOffers();
      } catch {
        coursePaymentOffers = [];
      }
      try {
        courseSummaries = await listDistrictCourseSummaries();
      } catch {
        courseSummaries = [];
      }
    }
    return { cabinetPricing, coursePaymentOffers, courseSummaries };
  };

  const [
    memberBlock,
    accessQuery,
    historyQuery,
    sanityBlock,
    enrollmentQuery,
  ] = await Promise.all([
    loadMemberBlock(),
    admin
      .from('user_accesses')
      .select('product, expires_at')
      .eq('telegram_id', telegramId)
      .eq('status', ACTIVE),
    admin.from('user_accesses').select('product').eq('telegram_id', telegramId),
    loadSanityBlock(),
    admin
      .from('course_enrollments')
      .select('status, started_at, course_id, purchase_scenario, courses(title, slug)')
      .eq('telegram_id', telegramId)
      .eq('status', ACTIVE)
      .order('started_at', { ascending: true }),
  ]);

  const { memberRoles, studentName } = memberBlock;
  const { cabinetPricing, courseSummaries } = sanityBlock;
  let { coursePaymentOffers } = sanityBlock;
  const { data: accessRows, error: accessError } = accessQuery;
  const accesses: CabinetAccess[] = accessError
    ? []
    : (accessRows ?? [])
        .filter((row) => isNotExpired(row.expires_at ?? null))
        .map((row) => ({
          product: row.product as CabinetAccessProduct,
          expiresAt: row.expires_at ?? null,
        }));

  const { data: historyRows } = historyQuery;
  let accessHistory: CabinetAccessProduct[] = [
    ...new Set((historyRows ?? []).map((row) => row.product as CabinetAccessProduct)),
  ];

  const dailyQuote = pickDailyCabinetQuote(cabinetPricing.quotes);

  let courseContent: DistrictCourseContent | null = null;
  let courseCatalogs: CabinetCourseCatalog[] = [];
  const preferredNormalizedEarly = preferredCourseSlug?.trim() || null;

  const { data: enrollmentRowsEarly, error: enrollmentErrorEarly } = enrollmentQuery;
  const enrollmentListEarly =
    (!enrollmentErrorEarly ? (enrollmentRowsEarly as EnrollmentRow[] | null) : null) ?? [];
  const primaryEnrollmentEarly = enrollmentListEarly[0] ?? null;
  const joinedCourseEarly = primaryEnrollmentEarly
    ? Array.isArray(primaryEnrollmentEarly.courses)
      ? primaryEnrollmentEarly.courses[0]
      : primaryEnrollmentEarly.courses
    : null;
  const courseContentSlugEarly =
    preferredNormalizedEarly ?? joinedCourseEarly?.slug ?? courseSummaries[0]?.slug ?? null;
  const courseContentEarlyPromise = courseContentSlugEarly
    ? getDistrictCourseContent(courseContentSlugEarly).catch((error) => {
        console.error('[cabinet] early course content fetch failed:', error);
        return null;
      })
    : null;

  const packagesFetchedPromise = loadPackages(admin, telegramId).catch((error) => {
    if (!isDegradedCabinetLoadError(error)) {
      console.error('[cabinet] packages prefetch failed:', error);
    }
    return [] as CabinetPackage[];
  });
  const profileFetchedPromise = loadProfile(admin, telegramId).catch((error) => {
    if (!isDegradedCabinetLoadError(error)) {
      console.error('[cabinet] profile prefetch failed:', error);
    }
    return { profile: null, courseMapViewed: false };
  });

  try {
    const idBySlug = await lookupCourseIdsBySlugs(
      admin,
      courseSummaries.map((s) => s.slug),
    );
    if (deferHeavyMaintenance) {
      for (const summary of courseSummaries) {
        const courseId = idBySlug.get(summary.slug);
        if (courseId) courseCatalogs.push(catalogFromSummary(summary, courseId));
      }
    } else {
    const missing = courseSummaries.filter((s) => !idBySlug.has(s.slug));
    if (missing.length > 0) {
      const prioritySlugs = new Set(
        [preferredNormalizedEarly, ...courseSummaries.map((s) => s.slug)].filter(Boolean) as string[],
      );
      const ensureOne = async (summary: DistrictCourseSummary) => {
        try {
          const id = await ensureDistrictCourseRecord(admin, {
            sanityId: summary.sanityId,
            title: summary.title,
            slug: summary.slug,
            description: summary.description,
            cabinetEyebrow: summary.cabinetEyebrow,
            deliveryFormat: summary.deliveryFormat,
            homeworkIntro: summary.homeworkIntro,
            coverImageUrl: summary.coverImageUrl,
            previewImageUrl: summary.previewImageUrl,
            previewInsideItems: summary.previewInsideItems,
            previewAfterEnrollment: summary.previewAfterEnrollment,
            previewAudience: summary.previewAudience,
            publicationStatus: summary.publicationStatus,
            showInCatalog: summary.showInCatalog,
            courseClosed: summary.courseClosed,
            curatorName: summary.curatorName,
            curatorTelegramId: summary.curatorTelegramId,
            checkTelegramId: null,
            priceByn: null,
            grantedLessons: null,
            pricingCardText: null,
            purchaseScenarios: null,
            activeModuleOverride: null,
            modules: [],
          });
          if (id) idBySlug.set(summary.slug, id);
        } catch (error) {
          console.error('[cabinet] course ensure failed:', summary.slug, error);
        }
      };
      const ensureNow = missing.filter((s) => prioritySlugs.has(s.slug));
      const ensureLater = missing.filter((s) => !prioritySlugs.has(s.slug));
      if (ensureNow.length > 0) {
        const ensureTask = Promise.all(ensureNow.map(ensureOne));
        if (deferHeavyMaintenance) {
          void ensureTask;
        } else {
          await ensureTask;
        }
      }
      if (ensureLater.length > 0) {
        void Promise.all(ensureLater.map(ensureOne));
      }
    }
    for (const summary of courseSummaries) {
      const courseId = idBySlug.get(summary.slug);
      if (courseId) courseCatalogs.push(catalogFromSummary(summary, courseId));
    }
    }
  } catch (error) {
    console.error('[cabinet] course catalog lookup failed:', error);
  }

  const { data: enrollmentRows, error: enrollmentError } = enrollmentQuery;

  const activeEnrollments = (!enrollmentError ? (enrollmentRows as EnrollmentRow[] | null) : null) ?? [];

  const courseEnrollments: CabinetEnrollment[] = activeEnrollments.map((row) => {
    const coursesRaw = row.courses;
    const joined = Array.isArray(coursesRaw) ? coursesRaw[0] : coursesRaw;
    return {
      courseId: row.course_id,
      courseTitle:
        joined?.title ??
        courseCatalogs.find((c) => c.id === row.course_id)?.title ??
        'РљСѓСЂСЃ District',
      status: row.status,
      startedAt: row.started_at,
      purchaseScenario: (row.purchase_scenario as 'start_from_beginning' | 'join_current' | null) ?? null,
    };
  });

  const preferredNormalized = preferredCourseSlug?.trim() || null;
  const preferredCatalog =
    (preferredNormalized
      ? courseCatalogs.find((c) => c.slug === preferredNormalized)
      : null) ?? null;

  const enrolledMatchingPreferred = preferredCatalog
    ? activeEnrollments.find((row) => row.course_id === preferredCatalog.id)
    : null;
  // Р‘РµР· ?course= вЂ” СЃР°РјС‹Р№ СЂР°РЅРЅРёР№ РєСѓРїР»РµРЅРЅС‹Р№ РєСѓСЂСЃ (ascending).
  const primaryEnrollment = enrolledMatchingPreferred ?? activeEnrollments[0] ?? null;

  let enrollment: CabinetEnrollment | null = null;
  let enrolledCourseId: number | null = null;
  if (primaryEnrollment) {
    enrolledCourseId = primaryEnrollment.course_id;
    enrollment =
      courseEnrollments.find((e) => e.courseId === enrolledCourseId) ??
      ({
        courseId: enrolledCourseId,
        courseTitle:
          courseCatalogs.find((c) => c.id === enrolledCourseId)?.title ?? 'РљСѓСЂСЃ District',
        status: primaryEnrollment.status,
        startedAt: primaryEnrollment.started_at,
        purchaseScenario:
          (primaryEnrollment.purchase_scenario as 'start_from_beginning' | 'join_current' | null) ??
          null,
      } satisfies CabinetEnrollment);
  }

  const activeSlug =
    preferredCatalog?.slug ??
    courseCatalogs.find((c) => c.id === enrolledCourseId)?.slug ??
    courseCatalogs[0]?.slug ??
    null;

  const loadMentorsBlock = async (): Promise<CabinetMentor[]> => {
    try {
      let mentorQuery = admin
        .from('mentor_assignments')
        .select('kind, mentor_telegram_id, course_id')
        .eq('telegram_id', telegramId)
        .eq('status', ACTIVE);
      if (enrolledCourseId != null) {
        mentorQuery = mentorQuery.or(`course_id.eq.${enrolledCourseId},course_id.is.null`);
      }
      const { data: mentorRows, error: mentorError } = await mentorQuery;
      const mentors: CabinetMentor[] = [];
      if (mentorError || !mentorRows?.length) return mentors;
      const mentorIds = mentorRows.map((row) => row.mentor_telegram_id);
      const { data: memberNames, error: namesError } = await admin
        .from('bot_members')
        .select('telegram_id, full_name')
        .in('telegram_id', mentorIds);
      if (namesError) return mentors;
      const names = new Map<number, string>(
        (memberNames ?? [])
          .filter((m) => m.full_name)
          .map((m) => [m.telegram_id, m.full_name]),
      );
      for (const row of mentorRows) {
        const name = names.get(row.mentor_telegram_id);
        if (name) mentors.push({ kind: row.kind as CabinetMentor['kind'], name });
      }
      return mentors;
    } catch (error) {
      if (!isDegradedCabinetLoadError(error)) throw error;
      return [];
    }
  };

  const [
    courseContentFetched,
    mentors,
    packagesFetched,
    paymentsFetched,
    profileFetched,
    achievementStatsFetched,
  ] = await Promise.all([
    (async () => {
      try {
        if (courseContentEarlyPromise) {
          const early = await courseContentEarlyPromise;
          if (early) return early;
        }
        return activeSlug
          ? await getDistrictCourseContent(activeSlug)
          : await getDistrictCourseContent();
      } catch (error) {
        console.error('[cabinet] course content fetch failed:', error);
        return null;
      }
    })(),
    deferSecondaryData ? Promise.resolve([] as CabinetMentor[]) : loadMentorsBlock(),
    packagesFetchedPromise,
    (async () => {
      try {
        return await loadPayments(admin, telegramId);
      } catch (error) {
        if (!isDegradedCabinetLoadError(error)) throw error;
        return [] as CabinetPayment[];
      }
    })(),
    profileFetchedPromise,
    deferSecondaryData
      ? Promise.resolve(EMPTY_CABINET_ACHIEVEMENT_STATS)
      : (async () => {
          try {
            return await loadAchievementStats(admin, telegramId);
          } catch (error) {
            if (!isDegradedCabinetLoadError(error)) throw error;
            return EMPTY_CABINET_ACHIEVEMENT_STATS;
          }
        })(),
  ]);

  courseContent = courseContentFetched;

  let courseCatalog: CabinetCourseCatalog | null =
    (activeSlug ? courseCatalogs.find((c) => c.slug === activeSlug) : null) ??
    courseCatalogs[0] ??
    null;

  let resolvedCourseId: number | null = courseCatalog?.id ?? null;
  if (!resolvedCourseId && courseContent) {
    try {
      if (deferHeavyMaintenance) {
        const ids = await lookupCourseIdsBySlugs(admin, [courseContent.slug]);
        resolvedCourseId = ids.get(courseContent.slug) ?? null;
      } else {
        resolvedCourseId = await resolveCourseIdForContent(admin, courseContent);
      }
    } catch {
      resolvedCourseId = null;
    }
  }

  if (courseCatalog && courseContent && courseCatalog.slug === courseContent.slug) {
    courseCatalog = {
      ...courseCatalog,
      title: courseContent.title || courseCatalog.title,
      description: courseContent.description?.trim() || courseCatalog.description,
      cabinetEyebrow: courseContent.cabinetEyebrow ?? courseCatalog.cabinetEyebrow,
      deliveryFormat: courseContent.deliveryFormat ?? courseCatalog.deliveryFormat,
      homeworkIntro: courseContent.homeworkIntro ?? courseCatalog.homeworkIntro,
      coverImageUrl: courseContent.coverImageUrl ?? courseCatalog.coverImageUrl,
      previewImageUrl: courseContent.previewImageUrl ?? courseCatalog.previewImageUrl,
      previewInsideItems:
        courseContent.previewInsideItems.length > 0
          ? courseContent.previewInsideItems
          : courseCatalog.previewInsideItems,
      previewAfterEnrollment:
        courseContent.previewAfterEnrollment ?? courseCatalog.previewAfterEnrollment,
      previewAudience: courseContent.previewAudience ?? courseCatalog.previewAudience,
      curatorName: courseContent.curatorName ?? courseCatalog.curatorName,
      totalLessons: countCourseLessons(courseContent) || courseCatalog.totalLessons,
      modulesCount:
        courseContent.modules.length ||
        courseCatalog.modulesCount ||
        courseCatalog.modulePreviews.length,
      modulePreviews:
        courseContent.modules.length > 0
          ? buildModulePreviewsFromContent(courseContent)
          : courseCatalog.modulePreviews,
    };
  } else if (!courseCatalog && resolvedCourseId && courseContent) {
    courseCatalog = {
      id: resolvedCourseId,
      title: courseContent.title,
      slug: courseContent.slug,
      description: courseContent.description?.trim() || null,
      cabinetEyebrow: courseContent.cabinetEyebrow,
      deliveryFormat: courseContent.deliveryFormat,
      homeworkIntro: courseContent.homeworkIntro,
      coverImageUrl: courseContent.coverImageUrl,
      previewImageUrl: courseContent.previewImageUrl,
      previewInsideItems: courseContent.previewInsideItems,
      previewAfterEnrollment: courseContent.previewAfterEnrollment,
      previewAudience: courseContent.previewAudience,
      sanityId: courseContent.sanityId,
      curatorName: courseContent.curatorName,
      totalLessons: countCourseLessons(courseContent),
      modulesCount: courseContent.modules.length,
      modulePreviews: buildModulePreviewsFromContent(courseContent),
    };
  }

  let packages = packagesFetched;
  let hasOrdinaryStudentTrack = false;
  const catalogTitleById = new Map(courseCatalogs.map((c) => [c.id, c.title]));
  const payments = paymentsFetched.map((p) => {
    if (p.product !== 'course' || p.courseId == null) return p;
    const title = catalogTitleById.get(p.courseId);
    return title ? { ...p, title } : p;
  });
  let profile: CabinetProfile | null = profileFetched.profile;
  let courseMapViewed = profileFetched.courseMapViewed;
  let courseProgress: CabinetCourseProgress[] = [];
  let courseModules: CabinetCourseModule[] = [];
  let courseStops: CabinetCourseStop[] = [];
  let lives: CabinetLivesState | null = null;

  const courseIdForMap = courseCatalog?.id ?? enrolledCourseId ?? resolvedCourseId ?? null;

  let enrollmentForCabinet = enrollment;
  let accessesForCabinet = accesses;
  if (courseIdForMap && courseContent?.modules.length) {
    const runPaidPackageReset = async () => {
      try {
        const { resetCourseWhenNoPaidPackages } = await import('@/lib/bot/education/course-access');
        await resetCourseWhenNoPaidPackages(admin, telegramId, courseIdForMap, courseContent);
      } catch (error) {
        if (!isCourseProgressTableError(error) && !isDegradedCabinetLoadError(error)) {
          console.error('[cabinet] background package reset failed:', error);
        }
      }
    };
    if (deferHeavyMaintenance) {
      void runPaidPackageReset();
    } else {
      try {
        const { resetCourseWhenNoPaidPackages } = await import('@/lib/bot/education/course-access');
        const didReset = await resetCourseWhenNoPaidPackages(
          admin,
          telegramId,
          courseIdForMap,
          courseContent,
        );
        if (didReset) {
          packages = await loadPackages(admin, telegramId);
          accessesForCabinet = accessesForCabinet.filter((a) => a.product !== 'course');
          if (enrollmentForCabinet) {
            enrollmentForCabinet = { ...enrollmentForCabinet, purchaseScenario: null };
          }
        }
      } catch (error) {
        if (!isCourseProgressTableError(error) && !isDegradedCabinetLoadError(error)) throw error;
      }
    }
  }

  accessHistory = mergeAccessHistoryFromPurchases(accessHistory, packages);
  const lessonsTrackFromRecords =
    accessHistory.includes('individual') ||
    accessHistory.includes('group') ||
    packages.some((p) => (p.product === 'individual' || p.product === 'group') && p.total > 0);
  if (!lessonsTrackFromRecords && !deferSecondaryData) {
    try {
      hasOrdinaryStudentTrack = await loadHasOrdinaryStudentTrack(admin, telegramId);
    } catch (error) {
      if (!isDegradedCabinetLoadError(error)) throw error;
    }
  }

  const cabinetSlice = { courseMapViewed, accesses: accessesForCabinet, packages };
  const courseState =
    courseIdForMap != null
      ? getCourseCabinetStateForCourse(
          cabinetSlice,
          courseIdForMap,
          courseContent?.slug,
          courseCatalog?.title ?? courseContent?.title,
        )
      : getCourseCabinetState(cabinetSlice);
  const hasCourseProductAccess = resolveMapHasCourseProductAccess(
    packages,
    courseIdForMap,
    courseContent?.slug,
    courseCatalog?.title ?? courseContent?.title,
  );
  const viewedCourseMap = hasViewedCourseMap(cabinetSlice);

  const mapWithProgress =
    loadMapProgress &&
    Boolean(courseIdForMap && (viewedCourseMap || courseState !== 'preview'));

  if (courseContent?.modules.length) {
    try {
      const mapData = await resolveCourseMapFromContent(admin, telegramId, courseIdForMap, courseContent, {
        courseState,
        hasCourseProductAccess,
        withProgress: mapWithProgress,
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
      if (mapData.progress.length > 0) courseProgress = mapData.progress;
    } catch (error) {
      if (!isCourseProgressTableError(error) && !isDegradedCabinetLoadError(error)) throw error;
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
    if (courseStops.length === 0 && courseContent.modules.length > 0) {
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
  } else if (loadMapProgress && viewedCourseMap && courseIdForMap) {
    try {
      const mapData = await loadCourseMapData(admin, telegramId, courseIdForMap, courseContent, {
        courseState,
        hasCourseProductAccess,
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
      if (mapData.progress.length > 0) courseProgress = mapData.progress;
    } catch (error) {
      if (!isCourseProgressTableError(error) && !isDegradedCabinetLoadError(error)) throw error;
    }
  }

  if (hasCourseProductAccess && courseIdForMap) {
    try {
      const livesState = await getEnrollmentLives(admin, telegramId, courseIdForMap);
      if (livesState) {
        lives = {
          current: livesState.lives_current,
          max: livesState.lives_max,
          accessBlocked: livesState.access_blocked,
          fullyBlocked: livesState.fully_blocked,
        };
      }
      void processHomeworkDeadlinesForStudent(admin, telegramId);
    } catch (error) {
      if (!isLivesTableError(error) && !isDegradedCabinetLoadError(error)) throw error;
    }
  }

  const courseIdBySlug = new Map(courseCatalogs.map((c) => [c.slug, c.id] as const));
  const summaryByCourseId = new Map<number, DistrictCourseSummary>();
  for (const s of courseSummaries) {
    const id = courseIdBySlug.get(s.slug);
    if (id != null) summaryByCourseId.set(id, s);
  }
  const ownedCourseIds = new Set<number>();
  for (const e of courseEnrollments) {
    if (e.courseId == null) continue;
    const summary = summaryByCourseId.get(e.courseId);
    if (summary && !isDistrictCoursePublicInCatalog(summary.showInCatalog)) {
      const cat = courseCatalogs.find((c) => c.id === e.courseId);
      if (
        !cat ||
        !hasCoursePaymentForCourse(packages, e.courseId, cat.slug, cat.title)
      ) {
        continue;
      }
    }
    ownedCourseIds.add(e.courseId);
  }
  for (const c of courseCatalogs) {
    if (hasCoursePaymentForCourse(packages, c.id, c.slug, c.title)) {
      ownedCourseIds.add(c.id);
    }
  }
  const visibleCatalogSlugs = new Set(
    filterCourseSummariesForCabinetAccess(courseSummaries, courseIdBySlug, ownedCourseIds).map(
      (s) => s.slug,
    ),
  );
  if (visibleCatalogSlugs.size > 0) {
    courseCatalogs = courseCatalogs.filter((c) => visibleCatalogSlugs.has(c.slug));
  }
  if (courseCatalog && !visibleCatalogSlugs.has(courseCatalog.slug)) {
    if (!ownedCourseIds.has(courseCatalog.id)) {
      courseCatalog = courseCatalogs[0] ?? null;
    }
  }

  const catalogsSynced =
    courseCatalog != null
      ? courseCatalogs.map((c) => (c.slug === courseCatalog.slug ? courseCatalog : c))
      : courseCatalogs;
  if (
    courseCatalog &&
    visibleCatalogSlugs.has(courseCatalog.slug) &&
    !catalogsSynced.some((c) => c.slug === courseCatalog.slug)
  ) {
    catalogsSynced.unshift(courseCatalog);
  }

  const achievementStats = achievementStatsFetched;

  if (courseContent?.purchaseScenarios) {
    coursePaymentOffers = coursePaymentOffers.map((offer) =>
      offer.slug === courseContent.slug
        ? { ...offer, purchaseScenarios: courseContent.purchaseScenarios }
        : offer,
    );
  }

  return {
    phone,
    createdAt,
    studentName,
    telegramLinked: true,
    telegramId,
    accesses: accessesForCabinet,
    accessHistory,
    enrollment: enrollmentForCabinet,
    courseEnrollments,
    courseCatalog,
    courseCatalogs: catalogsSynced,
    courseContent,
    dailyQuote,
    mentors,
    hasOrdinaryStudentTrack,
    packages,
    payments,
    profile,
    courseProgress,
    courseModules,
    courseStops,
    lives,
    cabinetPricing,
    coursePaymentOffers,
    courseMapViewed,
    memberRoles,
    achievementStats,
    courseMapProgressLoaded: loadMapProgress,
  };
}

/** Срез активного курса для быстрого переключения без полной перезагрузки кабинета. */
export type CabinetCourseViewSlice = {
  slug: string;
  courseCatalog: CabinetCourseCatalog;
  courseModules: CabinetCourseModule[];
  courseStops: CabinetCourseStop[];
  courseProgress: CabinetCourseProgress[];
  lives: CabinetLivesState | null;
  enrollment: CabinetEnrollment | null;
};

async function buildCourseMapSliceForSlug(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
  slug: string,
  options?: { skipMaintenance?: boolean },
): Promise<CabinetCourseViewSlice | null> {
  const courseContent = await getDistrictCourseContent(slug).catch(() => null);
  if (!courseContent || courseContent.courseClosed) return null;

  let courseId = (await lookupCourseIdsBySlugs(admin, [slug]).catch(() => new Map<string, number>())).get(
    slug,
  ) ?? null;
  if (!courseId && courseContent) {
    try {
      courseId = await resolveCourseIdForContent(admin, courseContent);
    } catch {
      courseId = null;
    }
  }
  if (!courseId) return null;

  const aliasIdsArr = await expandCourseIdAliases(admin, courseId);

  const courseCatalog: CabinetCourseCatalog = {
    id: courseId,
    title: courseContent.title,
    slug: courseContent.slug,
    description: courseContent.description?.trim() || null,
    cabinetEyebrow: courseContent.cabinetEyebrow,
    deliveryFormat: courseContent.deliveryFormat,
    homeworkIntro: courseContent.homeworkIntro,
    coverImageUrl: courseContent.coverImageUrl,
    previewImageUrl: courseContent.previewImageUrl,
    previewInsideItems: courseContent.previewInsideItems,
    previewAfterEnrollment: courseContent.previewAfterEnrollment,
    previewAudience: courseContent.previewAudience,
    sanityId: courseContent.sanityId,
    curatorName: courseContent.curatorName,
    totalLessons: countCourseLessons(courseContent),
    modulesCount: courseContent.modules.length,
    modulePreviews: buildModulePreviewsFromContent(courseContent),
  };

  const [{ data: accessRows }, { data: enrollmentRow }, { data: packageRows }, profileFetched] =
    await Promise.all([
      admin
        .from('user_accesses')
        .select('product, expires_at')
        .eq('telegram_id', telegramId)
        .eq('status', ACTIVE),
      admin
        .from('course_enrollments')
        .select('status, started_at, course_id, purchase_scenario')
        .eq('telegram_id', telegramId)
        .in('course_id', aliasIdsArr)
        .eq('status', ACTIVE)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('lesson_packages')
        .select('product, title, total_lessons, remaining_lessons, status, course_id')
        .eq('telegram_id', telegramId)
        .eq('product', 'course')
        .neq('status', 'cancelled'),
      loadProfile(admin, telegramId).catch(() => ({ profile: null, courseMapViewed: false })),
    ]);

  const accesses: CabinetAccess[] = (accessRows ?? [])
    .filter((row) => isNotExpired(row.expires_at ?? null))
    .map((row) => ({
      product: row.product as CabinetAccessProduct,
      expiresAt: row.expires_at ?? null,
    }));

  const aliasIds = new Set(aliasIdsArr);
  const pkgCourseIds = [
    ...new Set(
      (packageRows ?? [])
        .map((row) => row.course_id as number | null)
        .filter((id): id is number => id != null),
    ),
  ];
  const slugByPkgCourseId = new Map<number, string>();
  if (pkgCourseIds.length > 0) {
    const { data: courseRows } = await admin
      .from('courses')
      .select('id, slug')
      .in('id', pkgCourseIds);
    for (const c of courseRows ?? []) {
      if (c.id != null && c.slug) slugByPkgCourseId.set(c.id as number, c.slug as string);
    }
  }

  const allCoursePackages: CabinetPackage[] = (packageRows ?? []).map((row, index) => ({
    id: String(row.course_id ?? `legacy-${index}`),
    product: 'course' as const,
    title: (row.title as string) || courseCatalog.title,
    sub: '',
    remaining: row.remaining_lessons as number,
    total: row.total_lessons as number,
    active: row.status === 'active' && (row.remaining_lessons as number) > 0,
    courseId: (row.course_id as number | null) ?? null,
  }));

  const packages: CabinetPackage[] = (packageRows ?? [])
    .filter((row) =>
      coursePackageRowMatchesCourse(
        row.course_id as number | null,
        row.title as string | null,
        courseId,
        courseCatalog.slug,
        courseCatalog.title,
        aliasIds,
        slugByPkgCourseId,
      ),
    )
    .map((row, index) => ({
      id: String(index + 1),
      product: 'course' as const,
      title: (row.title as string) || courseCatalog.title,
      sub: '',
      remaining: row.remaining_lessons as number,
      total: row.total_lessons as number,
      active: row.status === 'active' && (row.remaining_lessons as number) > 0,
      courseId: (row.course_id as number | null) ?? null,
    }));

  const enrollment: CabinetEnrollment | null = enrollmentRow
    ? {
        courseId,
        courseTitle: courseCatalog.title,
        status: enrollmentRow.status as string,
        startedAt: enrollmentRow.started_at as string,
        purchaseScenario:
          (enrollmentRow.purchase_scenario as 'start_from_beginning' | 'join_current' | null) ??
          null,
      }
    : null;

  const cabinetSliceForState = {
    courseMapViewed: profileFetched.courseMapViewed,
    accesses,
    packages: allCoursePackages,
  };

  if (!options?.skipMaintenance) {
    void (async () => {
      try {
        const { resetCourseWhenNoPaidPackages } = await import('@/lib/bot/education/course-access');
        await resetCourseWhenNoPaidPackages(admin, telegramId, courseId, courseContent);
      } catch (error) {
        if (!isCourseProgressTableError(error) && !isDegradedCabinetLoadError(error)) {
          console.error('[cabinet] course slice maintenance failed:', error);
        }
      }
    })();
  }

  const courseState = getCourseCabinetStateForCourse(
    cabinetSliceForState,
    courseId,
    courseContent.slug,
    courseCatalog.title,
    aliasIdsArr,
  );
  const hasCourseProductAccess = resolveMapHasCourseProductAccess(
    allCoursePackages,
    courseId,
    courseContent.slug,
    courseCatalog.title,
    aliasIdsArr,
  );
  const viewedCourseMap = hasViewedCourseMap(cabinetSliceForState);
  const mapWithProgress = Boolean(courseId && (viewedCourseMap || courseState !== 'preview'));

  let courseModules: CabinetCourseModule[] = [];
  let courseStops: CabinetCourseStop[] = [];
  let courseProgress: CabinetCourseProgress[] = [];

  if (courseContent.modules.length) {
    if (mapWithProgress) {
      try {
        await processHomeworkDeadlinesForStudent(admin, telegramId);
      } catch (error) {
        if (!isDegradedCabinetLoadError(error)) {
          console.error('[cabinet] homework deadline sweep failed:', error);
        }
      }
    }
    try {
      const mapData = await resolveCourseMapFromContent(admin, telegramId, courseId, courseContent, {
        courseState,
        hasCourseProductAccess,
        withProgress: mapWithProgress,
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
      if (mapData.progress.length > 0) courseProgress = mapData.progress;
    } catch {
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
    if (courseStops.length === 0) {
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
  }

  let lives: CabinetLivesState | null = null;
  if (hasCourseProductAccess) {
    try {
      const livesState = await getEnrollmentLives(admin, telegramId, courseId);
      if (livesState) {
        lives = {
          current: livesState.lives_current,
          max: livesState.lives_max,
          accessBlocked: livesState.access_blocked,
          fullyBlocked: livesState.fully_blocked,
        };
      }
    } catch {
      lives = null;
    }
  }

  return {
    slug,
    courseCatalog,
    courseModules,
    courseStops,
    courseProgress,
    lives,
    enrollment,
  };
}

/** Только прогресс карты (без ensure курса и синхронного reset). */
export async function getCabinetCourseMapProgress(
  phone: string,
  courseSlug: string,
): Promise<CabinetCourseViewSlice | null> {
  const slug = courseSlug.trim();
  if (!slug) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) return null;

  return buildCourseMapSliceForSlug(admin, link.telegram_id as number, slug, {
    skipMaintenance: true,
  });
}

export async function getCabinetCourseViewSlice(
  phone: string,
  courseSlug: string,
): Promise<CabinetCourseViewSlice | null> {
  const slug = courseSlug.trim();
  if (!slug) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) return null;

  return buildCourseMapSliceForSlug(admin, link.telegram_id as number, slug);
}

export type CabinetLessonPageData = {
  courseCatalog: CabinetCourseCatalog | null;
  courseModules: CabinetCourseModule[];
  stop: CabinetCourseStop;
  courseState: CourseCabinetState;
};

function findLessonInContent(content: DistrictCourseContent, lessonKey: string): boolean {
  return flattenCourseLessons(content).some(
    (l) => l.sanityId === lessonKey || String(l.lessonNumber) === lessonKey,
  );
}

/** Только одно занятие: без полной карты курса / профиля / офферов. */
export async function getCabinetLessonPageData(
  phone: string,
  lessonId: string,
  preferredCourseSlug?: string | null,
): Promise<CabinetLessonPageData | null> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const lessonKey = decodeURIComponent(lessonId).trim();

  const linkRes = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (linkRes.error || !linkRes.data?.telegram_id) return null;
  const telegramId = linkRes.data.telegram_id as number;

  const slugHint = preferredCourseSlug?.trim() || null;
  let courseContent: DistrictCourseContent | null = null;
  let courseId: number | null = null;

  if (slugHint) {
    const [content, idMap] = await Promise.all([
      getDistrictCourseContent(slugHint).catch(() => null),
      lookupCourseIdsBySlugs(admin, [slugHint]).catch(() => new Map<string, number>()),
    ]);
    courseContent = content;
    courseId = idMap.get(slugHint) ?? null;
    if (courseContent && !findLessonInContent(courseContent, lessonKey)) {
      courseContent = null;
      courseId = null;
    }
  }

  if (!courseContent) {
    const { resolveCourseForSanityLesson } = await import('@/lib/bot/education/student-course-context');
    const resolvedCourse = await resolveCourseForSanityLesson(admin, telegramId, lessonKey);
    courseContent =
      resolvedCourse?.content ?? (await getDistrictCourseContent().catch(() => null));
    courseId = resolvedCourse?.courseId ?? null;
  }
  if (!courseContent || courseContent.courseClosed) return null;
  if (!courseContent.modules.length) notFound();

  type Located = {
    lesson: (typeof courseContent.modules)[0]['lessons'][0];
    moduleIndex: number;
    numInModule: number;
    lessonIndex: number;
  };

  const allVisible: Located[] = [];
  courseContent.modules.forEach((mod, moduleIndex) => {
    let numInModule = 0;
    for (const lesson of mod.lessons) {
      if (lesson.publicationStatus === 'archived') continue;
      numInModule += 1;
      allVisible.push({
        lesson,
        moduleIndex,
        numInModule,
        lessonIndex: allVisible.length,
      });
    }
  });

  const located =
    allVisible.find((x) => x.lesson.sanityId === lessonKey) ??
    allVisible.find((x) => String(x.lessonIndex + 1) === lessonKey) ??
    allVisible.find((x) => String(x.lesson.lessonNumber) === lessonKey);

  if (!located) notFound();

  if (courseId == null) {
    courseId = await resolveCourseIdForContent(admin, courseContent);
  }

  const [{ data: enrollmentRows }, { data: accessProductRows }, { data: packageRows }] =
    await Promise.all([
      courseId != null
        ? admin
            .from('course_enrollments')
            .select('status, course_id')
            .eq('telegram_id', telegramId)
            .eq('course_id', courseId)
            .eq('status', ACTIVE)
            .maybeSingle()
            .then((r) => ({ data: r.data ? [r.data] : [] }))
        : admin
            .from('course_enrollments')
            .select('status, course_id')
            .eq('telegram_id', telegramId)
            .eq('status', ACTIVE)
            .order('started_at', { ascending: false })
            .limit(1),
      admin
        .from('user_accesses')
        .select('product, expires_at')
        .eq('telegram_id', telegramId)
        .eq('status', ACTIVE),
      admin
        .from('lesson_packages')
        .select('product, total_lessons, remaining_lessons, status, course_id')
        .eq('telegram_id', telegramId)
        .eq('status', 'active'),
    ]);

  const accesses: CabinetAccess[] = (accessProductRows ?? [])
    .filter((row) => isNotExpired(row.expires_at ?? null))
    .map((row) => ({
      product: row.product as CabinetAccessProduct,
      expiresAt: row.expires_at ?? null,
    }));
  const packages: CabinetPackage[] = (packageRows ?? []).map((row, index) => ({
    id: String(index + 1),
    product: row.product as CabinetAccessProduct,
    title: row.product as string,
    sub: '',
    remaining: row.remaining_lessons as number,
    total: row.total_lessons as number,
    active: row.status === 'active' && (row.remaining_lessons as number) > 0,
    courseId: (row.course_id as number | null | undefined) ?? null,
  }));

  const enrolled = Boolean(enrollmentRows?.[0]);
  const cabinetSlice = { courseMapViewed: enrolled, accesses, packages };
  const courseSlugForState = courseContent.slug;
  const courseState =
    courseId != null
      ? getCourseCabinetStateForCourse(cabinetSlice, courseId, courseSlugForState)
      : getCourseCabinetState(cabinetSlice);
  if (courseState === 'preview') {
    redirect('/cabinet?section=course');
  }

  const hasCourseProduct = resolveMapHasCourseProductAccess(
    packages,
    courseId,
    courseSlugForState,
  );

  let accessBlocked = false;
  let fullyBlocked = false;
  if (courseId) {
    const livesState = await getEnrollmentLives(admin, telegramId, courseId);
    accessBlocked = livesState?.access_blocked ?? false;
    fullyBlocked = livesState?.fully_blocked ?? false;
    const shouldSync = hasCourseProduct && !accessBlocked && !fullyBlocked;
    if (shouldSync) {
      void (async () => {
        try {
          const { syncJoinCurrentEnrollmentAccess } = await import(
            '@/lib/bot/education/course-access'
          );
          await syncJoinCurrentEnrollmentAccess(admin, telegramId, courseId!, courseContent, null);
        } catch (error) {
          if (!isCourseProgressTableError(error)) {
            console.error('[cabinet] lesson page background sync failed:', error);
          }
        }
      })();
    }
  }

  try {
    await processHomeworkDeadlinesForStudent(admin, telegramId);
  } catch (error) {
    if (!isDegradedCabinetLoadError(error)) {
      console.error('[cabinet] lesson homework sweep failed:', error);
    }
  }

  if (hasCourseProduct && courseId) {
    try {
      const { ensureTrialHomeworkDeadlineIfEligible } = await import(
        '@/lib/bot/education/homework-deadline'
      );
      await ensureTrialHomeworkDeadlineIfEligible(admin, telegramId, courseContent, courseId);
    } catch (error) {
      if (!isCourseProgressTableError(error)) {
        console.error('[cabinet] lesson page trial deadline sync failed:', error);
      }
    }
  }

  const mapStops = await buildCourseMapStopsFromContent(
    admin,
    telegramId,
    courseContent,
    accessBlocked,
    {
      courseState,
      hasCourseProductAccess: hasCourseProduct,
      fullyBlocked,
      courseId: courseId ?? undefined,
    },
  );
  const mapStop = mapStops.find((s) => s.sanityLessonId === located.lesson.sanityId);
  if (!mapStop) notFound();

  const stop = mapStopToCabinet(mapStop);

  const courseModules = mapContentToCourseModules(courseContent);
  const courseCatalog: CabinetCourseCatalog = {
    id: 0,
    title: courseContent.title,
    slug: courseContent.slug,
    description: courseContent.description?.trim() || null,
    cabinetEyebrow: courseContent.cabinetEyebrow ?? null,
    deliveryFormat: courseContent.deliveryFormat ?? null,
    homeworkIntro: courseContent.homeworkIntro ?? null,
    coverImageUrl: courseContent.coverImageUrl ?? null,
    previewImageUrl: courseContent.previewImageUrl ?? null,
    previewInsideItems: courseContent.previewInsideItems ?? [],
    previewAfterEnrollment: courseContent.previewAfterEnrollment ?? null,
    previewAudience: courseContent.previewAudience ?? null,
    sanityId: courseContent.sanityId ?? null,
    curatorName: courseContent.curatorName ?? null,
    totalLessons: countCourseLessons(courseContent),
    modulesCount: courseContent.modules.length,
    modulePreviews: [],
  };

  return {
    courseCatalog,
    courseModules,
    stop,
    courseState,
  };
}
