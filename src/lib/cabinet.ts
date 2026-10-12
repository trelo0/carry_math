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
  type CourseMapStop,
  type CourseMapStopStatus,
} from '@/lib/bot/education/course-progress';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import { processHomeworkDeadlinesForStudent } from '@/lib/bot/education/homework-deadline-notify';
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
  attachPurchaseScenariosToOffers,
  getDistrictCourseContent,
  listCoursePaymentOffers,
  listDistrictCourseSummaries,
  mapLessonKind,
  type CoursePaymentOffer,
  type DistrictCourseContent,
  type DistrictCourseSummary,
} from '@/lib/studio/courseContent';
import {
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
  isPurchaseRequestTableError,
  listPurchaseRequestsForUser,
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
};

export type CabinetPaymentStatus = 'paid' | 'pending' | 'rejected';

export type CabinetPayment = {
  id: string;
  date: string;
  title: string;
  price: string;
  status: CabinetPaymentStatus;
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
  /** 0-100: material 60% + HW 40% */
  lessonProgressPercent: number;
  isTrialFree: boolean;
  contentChips: string[];
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  homeworkFiles: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
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

/** РћРїР»Р°С‚Р° РєСѓСЂСЃР°: РґРѕСЃС‚СѓРї product=course РёР»Рё Р°РєС‚РёРІРЅС‹Р№ РїР°РєРµС‚ Р·Р°РЅСЏС‚РёР№ РєСѓСЂСЃР°. */
export function hasCoursePayment(data: Pick<CabinetData, 'accesses' | 'packages'>): boolean {
  if (data.accesses.some((a) => a.product === 'course')) return true;
  return data.packages.some((p) => p.product === 'course' && p.active && p.total > 0);
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

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const PRODUCT_LABELS: Record<CabinetAccessProduct, string> = {
  course: 'РљСѓСЂСЃ District',
  individual: 'РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Рµ Р·Р°РЅСЏС‚РёСЏ',
  group: 'Р“СЂСѓРїРїРѕРІС‹Рµ Р·Р°РЅСЏС‚РёСЏ',
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
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function loadPackages(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<CabinetPackage[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, product, title, total_lessons, used_lessons, remaining_lessons, status')
    .eq('telegram_id', telegramId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id),
    product: row.product as CabinetAccessProduct,
    title: row.title,
    sub: PRODUCT_LABELS[row.product as CabinetAccessProduct] ?? row.title,
    remaining: row.remaining_lessons,
    total: row.total_lessons,
    active: row.status === 'active' && row.remaining_lessons > 0,
  }));
}

async function loadPayments(
  admin: ReturnType<typeof createAdminClient>,
  telegramId: number,
): Promise<CabinetPayment[]> {
  const { data: paidRows, error: paidError } = await admin
    .from('payments')
    .select('id, product, amount_byn, paid_at')
    .eq('telegram_id', telegramId)
    .order('paid_at', { ascending: false })
    .limit(20);
  if (paidError) throw paidError;

  const paid: CabinetPayment[] = (paidRows ?? []).map((row) => ({
    id: `pay-${row.id}`,
    date: formatPaymentDate(row.paid_at),
    title: PRODUCT_LABELS[row.product as CabinetAccessProduct] ?? row.product,
    price: String(row.amount_byn),
    status: 'paid' as const,
  }));

  let requests: CabinetPayment[] = [];
  try {
    const rows = await listPurchaseRequestsForUser(admin, telegramId, 20);
    requests = rows
      .filter((row) => row.status !== 'approved')
      .map((row) => ({
        id: row.id,
        date: formatPaymentDate(row.created_at),
        title: row.title,
        price: String(row.amount_byn),
        status: row.status === 'pending' ? ('pending' as const) : ('rejected' as const),
      }));
  } catch (error) {
    if (!isPurchaseRequestTableError(error)) throw error;
  }

  return [...requests, ...paid]
    .sort((a, b) => {
      const parse = (value: string) => {
        const parts = value.split('.');
        if (parts.length !== 3) return 0;
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
      };
      return parse(b.date) - parse(a.date);
    })
    .slice(0, 20);
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
  if (!iso) return 'вЂ”';
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
    lessonProgressPercent: stop.lessonProgressPercent,
    isTrialFree: stop.isTrialFree,
    contentChips: stop.contentChips,
    materials: stop.materials,
    homeworkFiles: stop.homeworkFiles,
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
export function lessonPathForStop(stop: Pick<CabinetCourseStop, 'sanityLessonId' | 'id'>): string {
  return `/cabinet/lesson/${encodeURIComponent(stop.sanityLessonId ?? String(stop.id))}`;
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
        lessonProgressPercent: 0,
        isTrialFree: false,
        contentChips: [],
        materials: [],
        homeworkFiles: [],
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
    const mapStops = await buildCourseMapStopsFromContent(admin, telegramId, content, accessBlocked, {
      courseState: options.courseState,
      hasCourseProductAccess: options.hasCourseProductAccess,
      fullyBlocked: livesState?.fully_blocked ?? false,
    });
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
): Promise<CabinetData> {
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
  if (linkError || !link?.telegram_id) return empty;
  const telegramId = link.telegram_id as number;

  // РРјСЏ Рё СЂРѕР»Рё СѓС‡Р°СЃС‚РЅРёРєР° РёР· РїСЂРѕС„РёР»СЏ Р±РѕС‚Р°.
  let memberRoles: BotRole[] = ['guest'];
  let studentName: string | null = null;
  try {
    memberRoles = await loadMemberRoles(admin, telegramId);
    const { data: member } = await admin
      .from('bot_members')
      .select('full_name')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    studentName = member?.full_name ?? null;
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }

  // РђРєС‚РёРІРЅС‹Рµ РїСЂРѕРґСѓРєС‚РѕРІС‹Рµ РґРѕСЃС‚СѓРїС‹.
  const { data: accessRows, error: accessError } = await admin
    .from('user_accesses')
    .select('product, expires_at')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE);
  const accesses: CabinetAccess[] = accessError
    ? []
    : (accessRows ?? [])
        .filter((row) => isNotExpired(row.expires_at ?? null))
        .map((row) => ({
          product: row.product as CabinetAccessProduct,
          expiresAt: row.expires_at ?? null,
        }));

  const { data: historyRows } = await admin
    .from('user_accesses')
    .select('product')
    .eq('telegram_id', telegramId);
  let accessHistory: CabinetAccessProduct[] = [
    ...new Set((historyRows ?? []).map((row) => row.product as CabinetAccessProduct)),
  ];

  // РљРѕРЅС‚РµРЅС‚ РєСѓСЂСЃРѕРІ РёР· Sanity + lookup courses РІ Supabase (Р±РµР· UPDATE РЅР° РєР°Р¶РґС‹Р№ Р·Р°С…РѕРґ).
  let courseContent: DistrictCourseContent | null = null;
  let cabinetPricing: CabinetPricing = DEFAULT_CABINET_PRICING;
  let coursePaymentOffers: CoursePaymentOffer[] = [];
  let courseSummaries: DistrictCourseSummary[] = [];
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

  try {
    coursePaymentOffers = await attachPurchaseScenariosToOffers(coursePaymentOffers);
  } catch (error) {
    console.error('[cabinet] purchase scenarios attach failed:', error);
  }

  const dailyQuote = pickDailyCabinetQuote(cabinetPricing.quotes);

  const courseCatalogs: CabinetCourseCatalog[] = [];
  try {
    const idBySlug = await lookupCourseIdsBySlugs(
      admin,
      courseSummaries.map((s) => s.slug),
    );
    const missing = courseSummaries.filter((s) => !idBySlug.has(s.slug));
    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (summary) => {
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
              curatorName: summary.curatorName,
              curatorTelegramId: summary.curatorTelegramId,
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
        }),
      );
    }
    for (const summary of courseSummaries) {
      const courseId = idBySlug.get(summary.slug);
      if (courseId) courseCatalogs.push(catalogFromSummary(summary, courseId));
    }
  } catch (error) {
    console.error('[cabinet] course catalog lookup failed:', error);
  }

  // РђРєС‚РёРІРЅС‹Рµ Р·Р°С‡РёСЃР»РµРЅРёСЏ (РІСЃРµ РєСѓСЂСЃС‹).
  const { data: enrollmentRows, error: enrollmentError } = await admin
    .from('course_enrollments')
    .select('status, started_at, course_id, courses(title, slug)')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: true });

  type EnrollmentRow = {
    status: string;
    started_at: string;
    course_id: number;
    courses: { title?: string; slug?: string } | { title?: string; slug?: string }[] | null;
  };
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
      } satisfies CabinetEnrollment);
  }

  const activeSlug =
    preferredCatalog?.slug ??
    courseCatalogs.find((c) => c.id === enrolledCourseId)?.slug ??
    courseCatalogs[0]?.slug ??
    null;

  try {
    courseContent = activeSlug
      ? await getDistrictCourseContent(activeSlug)
      : await getDistrictCourseContent();
  } catch (error) {
    console.error('[cabinet] course content fetch failed:', error);
    courseContent = null;
  }

  let courseCatalog: CabinetCourseCatalog | null =
    (activeSlug ? courseCatalogs.find((c) => c.slug === activeSlug) : null) ??
    courseCatalogs[0] ??
    null;

  let resolvedCourseId: number | null = courseCatalog?.id ?? null;
  if (!resolvedCourseId && courseContent) {
    try {
      resolvedCourseId = await resolveCourseIdForContent(admin, courseContent);
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

  // РђРєС‚РёРІРЅС‹Рµ РЅР°СЃС‚Р°РІРЅРёРєРё (РїСЂРµРїРѕРґР°РІР°С‚РµР»СЊ/РєСѓСЂР°С‚РѕСЂ).
  const { data: mentorRows, error: mentorError } = await admin
    .from('mentor_assignments')
    .select('kind, mentor_telegram_id')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE);
  const mentors: CabinetMentor[] = [];
  if (!mentorError && mentorRows?.length) {
    const mentorIds = mentorRows.map((row) => row.mentor_telegram_id);
    const { data: memberNames } = await admin
      .from('bot_members')
      .select('telegram_id, full_name')
      .in('telegram_id', mentorIds);
    const names = new Map<number, string>(
      (memberNames ?? [])
        .filter((m) => m.full_name)
        .map((m) => [m.telegram_id, m.full_name]),
    );
    for (const row of mentorRows) {
      const name = names.get(row.mentor_telegram_id);
      if (name) mentors.push({ kind: row.kind as CabinetMentor['kind'], name });
    }
  }

  let packages: CabinetPackage[] = [];
  let hasOrdinaryStudentTrack = false;
  let payments: CabinetPayment[] = [];
  let profile: CabinetProfile | null = null;
  let courseMapViewed = false;
  let courseProgress: CabinetCourseProgress[] = [];
  let courseModules: CabinetCourseModule[] = [];
  let courseStops: CabinetCourseStop[] = [];
  let lives: CabinetLivesState | null = null;

  const courseIdForMap = courseCatalog?.id ?? enrolledCourseId ?? resolvedCourseId ?? null;

  try {
    packages = await loadPackages(admin, telegramId);
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }
  accessHistory = mergeAccessHistoryFromPurchases(accessHistory, packages);
  const lessonsTrackFromRecords =
    accessHistory.includes('individual') ||
    accessHistory.includes('group') ||
    packages.some((p) => (p.product === 'individual' || p.product === 'group') && p.total > 0);
  if (!lessonsTrackFromRecords) {
    try {
      hasOrdinaryStudentTrack = await loadHasOrdinaryStudentTrack(admin, telegramId);
    } catch (error) {
      if (!isCabinetTableError(error)) throw error;
    }
  }
  try {
    payments = await loadPayments(admin, telegramId);
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }
  try {
    const loadedProfile = await loadProfile(admin, telegramId);
    profile = loadedProfile.profile;
    courseMapViewed = loadedProfile.courseMapViewed;
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }

  const cabinetSlice = { courseMapViewed, accesses, packages };
  const courseState = getCourseCabinetState(cabinetSlice);
  const hasCourseProductAccess = hasCoursePayment(cabinetSlice);
  const viewedCourseMap = hasViewedCourseMap(cabinetSlice);

  if (courseContent?.modules.length) {
    try {
      const mapData = await resolveCourseMapFromContent(admin, telegramId, courseIdForMap, courseContent, {
        courseState,
        hasCourseProductAccess,
        // РџСЂРѕРіСЂРµСЃСЃ РЅСѓР¶РµРЅ Рё РЅР° РїСЂРѕР±РЅРѕРј (enrolled_locked), РЅРµ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ РѕРїР»Р°С‚С‹.
        withProgress: Boolean(courseIdForMap && (viewedCourseMap || courseState !== 'preview')),
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
      if (mapData.progress.length > 0) courseProgress = mapData.progress;
    } catch (error) {
      if (!isCourseProgressTableError(error) && !isCabinetTableError(error)) throw error;
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
    if (courseStops.length === 0 && courseContent.modules.length > 0) {
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
  } else if (viewedCourseMap && courseIdForMap) {
    try {
      const mapData = await loadCourseMapData(admin, telegramId, courseIdForMap, courseContent, {
        courseState,
        hasCourseProductAccess,
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
      if (mapData.progress.length > 0) courseProgress = mapData.progress;
    } catch (error) {
      if (!isCourseProgressTableError(error) && !isCabinetTableError(error)) throw error;
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
      if (!isLivesTableError(error)) throw error;
    }
  }

  const catalogsSynced =
    courseCatalog != null
      ? courseCatalogs.map((c) => (c.slug === courseCatalog.slug ? courseCatalog : c))
      : courseCatalogs;
  if (courseCatalog && !catalogsSynced.some((c) => c.slug === courseCatalog.slug)) {
    catalogsSynced.unshift(courseCatalog);
  }

  let achievementStats = EMPTY_CABINET_ACHIEVEMENT_STATS;
  try {
    achievementStats = await loadAchievementStats(admin, telegramId);
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }

  return {
    phone,
    createdAt,
    studentName,
    telegramLinked: true,
    accesses,
    accessHistory,
    enrollment,
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
  };
}

/** РЎСЂРµР· Р°РєС‚РёРІРЅРѕРіРѕ РєСѓСЂСЃР° РґР»СЏ Р±С‹СЃС‚СЂРѕРіРѕ РїРµСЂРµРєР»СЋС‡РµРЅРёСЏ Р±РµР· РїРѕР»РЅРѕР№ РїРµСЂРµР·Р°РіСЂСѓР·РєРё РєР°Р±РёРЅРµС‚Р°. */
export type CabinetCourseViewSlice = {
  slug: string;
  courseCatalog: CabinetCourseCatalog;
  courseModules: CabinetCourseModule[];
  courseStops: CabinetCourseStop[];
  courseProgress: CabinetCourseProgress[];
  lives: CabinetLivesState | null;
  enrollment: CabinetEnrollment | null;
};

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
  const telegramId = link.telegram_id as number;

  const courseContent = await getDistrictCourseContent(slug).catch(() => null);
  if (!courseContent) return null;

  let courseId: number | null = null;
  try {
    courseId = await resolveCourseIdForContent(admin, courseContent);
  } catch {
    const ids = await lookupCourseIdsBySlugs(admin, [slug]).catch(() => new Map());
    courseId = ids.get(slug) ?? null;
  }
  if (!courseId) return null;

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

  // Enrollment + accesses РїР°СЂР°Р»Р»РµР»СЊРЅРѕ; packages/profile РґР»СЏ switch РЅРµ РЅСѓР¶РЅС‹.
  const [{ data: accessRows }, { data: enrollmentRow }] = await Promise.all([
    admin
      .from('user_accesses')
      .select('product, expires_at')
      .eq('telegram_id', telegramId)
      .eq('status', ACTIVE),
    admin
      .from('course_enrollments')
      .select('status, started_at, course_id')
      .eq('telegram_id', telegramId)
      .eq('course_id', courseId)
      .eq('status', ACTIVE)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const accesses: CabinetAccess[] = (accessRows ?? [])
    .filter((row) => isNotExpired(row.expires_at ?? null))
    .map((row) => ({
      product: row.product as CabinetAccessProduct,
      expiresAt: row.expires_at ?? null,
    }));

  const enrollment: CabinetEnrollment | null = enrollmentRow
    ? {
        courseId,
        courseTitle: courseCatalog.title,
        status: enrollmentRow.status as string,
        startedAt: enrollmentRow.started_at as string,
      }
    : null;

  const hasCourseProductAccess =
    enrollment != null || accesses.some((a) => a.product === 'course');
  const courseState: CourseCabinetState = hasCourseProductAccess ? 'full' : 'preview';

  let courseModules: CabinetCourseModule[] = [];
  let courseStops: CabinetCourseStop[] = [];
  let courseProgress: CabinetCourseProgress[] = [];

  if (courseContent.modules.length) {
    try {
      const mapData = await resolveCourseMapFromContent(admin, telegramId, courseId, courseContent, {
        courseState,
        hasCourseProductAccess,
        withProgress: Boolean(hasCourseProductAccess && courseId),
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

export type CabinetLessonPageData = {
  courseCatalog: CabinetCourseCatalog | null;
  courseModules: CabinetCourseModule[];
  stop: CabinetCourseStop;
  courseState: CourseCabinetState;
};

/** РўРѕР»СЊРєРѕ РѕРґРЅРѕ Р·Р°РЅСЏС‚РёРµ: Р±РµР· РїРѕР»РЅРѕР№ РєР°СЂС‚С‹ РєСѓСЂСЃР° / РїСЂРѕС„РёР»СЏ / РѕС„С„РµСЂРѕРІ. */
export async function getCabinetLessonPageData(
  phone: string,
  lessonId: string,
): Promise<CabinetLessonPageData | null> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const lessonKey = decodeURIComponent(lessonId).trim();

  const [linkRes, courseContent] = await Promise.all([
    admin.from('telegram_links').select('telegram_id').eq('phone', phone).maybeSingle(),
    getDistrictCourseContent().catch(() => null),
  ]);

  if (linkRes.error || !linkRes.data?.telegram_id) return null;
  const telegramId = linkRes.data.telegram_id as number;
  if (!courseContent?.modules.length) notFound();

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

  const orderedPublished = flattenCourseLessons(courseContent).filter(
    (l) => l.publicationStatus === 'published',
  );
  const publishedIndex = orderedPublished.findIndex((l) => l.sanityId === located.lesson.sanityId);
  const gateLessons =
    publishedIndex >= 0 ? orderedPublished.slice(0, publishedIndex + 1) : [located.lesson];
  const gateIds = gateLessons.map((l) => l.sanityId);

  const [{ data: enrollmentRows }, { data: accessProductRows }, { data: packageRows }, accessProg, sessionMap] =
    await Promise.all([
      admin
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
        .select('product, total_lessons, remaining_lessons, status')
        .eq('telegram_id', telegramId)
        .eq('status', 'active'),
      Promise.all([
        admin
          .from('course_lesson_access')
          .select('sanity_lesson_id, access_status')
          .eq('telegram_id', telegramId)
          .in('sanity_lesson_id', gateIds),
        admin
          .from('course_lesson_student_progress')
          .select('*')
          .eq('telegram_id', telegramId)
          .in('sanity_lesson_id', gateIds),
      ]),
      loadSanityLessonSessionMap(admin, [located.lesson.sanityId]),
    ]);

  const [accessRes, progressRes] = accessProg;
  const accessMap = new Map(
    (accessRes.data ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );
  const progressMap = new Map<string, CourseLessonStudentProgress | undefined>(
    (progressRes.data ?? []).map((r) => [
      r.sanity_lesson_id as string,
      r as CourseLessonStudentProgress,
    ]),
  );

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
  }));

  const enrolled = Boolean(enrollmentRows?.[0]);
  const cabinetSlice = { courseMapViewed: enrolled, accesses, packages };
  const courseState = getCourseCabinetState(cabinetSlice);
  if (courseState === 'preview') {
    redirect('/cabinet?section=course');
  }

  const hasCourseProduct = hasCoursePayment(cabinetSlice);
  const trialPreviewOnly = located.lesson.isTrialFree && !hasCourseProduct;

  const previousCleared =
    publishedIndex <= 0
      ? true
      : previousCourseLessonsCleared(orderedPublished, publishedIndex, progressMap, {
          hasCourseProduct,
        });

  const rawAccess = accessMap.get(located.lesson.sanityId) ?? null;
  let hasAccess = false;
  let accessStatus: string | null = rawAccess;
  if (!previousCleared) {
    hasAccess = false;
  } else if (rawAccess === 'available' || rawAccess === 'blocked_lives') {
    hasAccess = true;
  } else if (rawAccess === 'revoked') {
    hasAccess = false;
  } else if (courseState === 'enrolled_locked' && located.lesson.isTrialFree) {
    hasAccess = true;
    accessStatus = 'available';
  }

  const progress = progressMap.get(located.lesson.sanityId);
  // Таймер ДЗ стартует только по Play на /cabinet/lesson (watch-*), не при открытии страницы.
  if (hasAccess && hasCourseProduct) {
    void processHomeworkDeadlinesForStudent(admin, telegramId);
  }

  const sessionStatus =
    located.lesson.lessonType === 'webinar'
      ? resolveWebinarSessionStatus(
          located.lesson.scheduledAt,
          sessionMap.get(located.lesson.sanityId),
        )
      : null;

  const isCurrent =
    hasAccess &&
    !isCourseLessonCleared(located.lesson, progress, { hasCourseProduct }) &&
    previousCleared;

  const status = computeMapStopStatus({
    hasAccess,
    accessBlocked: false,
    accessStatus,
    sessionStatus,
    progress,
    isCurrent,
  });

  const stop: CabinetCourseStop = {
    id: located.lessonIndex + 1,
    sanityLessonId: located.lesson.sanityId,
    lessonId: null,
    module: located.moduleIndex,
    numInModule: located.numInModule,
    isCurrent,
    status,
    kind: mapLessonKind(located.lesson.lessonType),
    title: located.lesson.title,
    description: located.lesson.description,
    date: formatSessionDate(located.lesson.scheduledAt),
    sessionStartsAt: located.lesson.scheduledAt,
    liveUrl: located.lesson.liveUrl,
    recordingUrl: located.lesson.recordingUrl,
    webinarSessionStatus: sessionStatus,
    mandatoryHomework: homeworkRequiredForLesson(located.lesson, hasCourseProduct),
    homeworkStatus: trialPreviewOnly ? null : (progress?.homework_status ?? null),
    homeworkTitle: located.lesson.homework?.title ?? null,
    homeworkReviewNote: progress?.review_note ?? null,
    homeworkCompletedAt: progress?.homework_completed_at ?? null,
    homeworkDeadlineAt: trialPreviewOnly ? null : (progress?.homework_deadline_at ?? null),
    homeworkRemainingMs: trialPreviewOnly
      ? null
      : typeof progress?.homework_remaining_ms === 'number'
        ? progress.homework_remaining_ms
        : null,
    homeworkOverdueAt: trialPreviewOnly ? null : (progress?.homework_overdue_at ?? null),
    lessonProgressPercent: computeLessonProgressPercent({
      recordingWatchedAt: progress?.recording_watched_at,
      liveAttendedAt: progress?.live_attended_at,
      homeworkStatus: progress?.homework_status,
      hasHomework: homeworkRequiredForLesson(located.lesson, hasCourseProduct),
    }),
    isTrialFree: located.lesson.isTrialFree,
    contentChips:
      located.lesson.contentChips?.length > 0
        ? located.lesson.contentChips
        : [...DEFAULT_LESSON_CONTENT_CHIPS],
    materials: located.lesson.materials.map((m) => ({
      title: m.title,
      fileName: m.fileName,
      fileSize: m.fileSize,
      url: m.url,
    })),
    homeworkFiles: located.lesson.homeworkFiles.map((m) => ({
      title: m.title,
      fileName: m.fileName,
      fileSize: m.fileSize,
      url: m.url,
    })),
  };

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
