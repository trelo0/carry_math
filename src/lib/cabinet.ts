import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
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
import { getCabinetPricing, DEFAULT_CABINET_PRICING, type CabinetPricing } from '@/lib/studio/cabinetSettings';
import {
  countCourseLessons,
  getDistrictCourseContent,
  type DistrictCourseContent,
} from '@/lib/studio/courseContent';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
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
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

// Данные личного кабинета ученика.
//
// Схема проекта связывает ученика с учебными данными так:
//   auth-пользователь (телефон) → telegram_links → telegram_id →
//   → user_accesses / course_enrollments / groups / mentor_assignments.
//
// Все таблицы закрыты RLS (только service_role), поэтому чтение идёт
// через серверный admin-клиент. Никаких новых таблиц не создаём:
// разделы без данных (ДЗ, платежи, жизни) отображаются как «скоро».

export type CabinetSection = 'course' | 'lessons' | 'schedule' | 'payments' | 'settings';
export type CabinetAccessProduct = 'course' | 'individual' | 'group';
export type CourseCabinetState = 'preview' | 'enrolled_locked' | 'full';

export type CabinetAccess = {
  product: CabinetAccessProduct;
  expiresAt: string | null; // null = бессрочный
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
  previewInsideItems: string[];
  previewAfterEnrollment: string | null;
  previewAudience: string | null;
  sanityId: string | null;
  curatorName: string | null;
  totalLessons: number;
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
  contentChips: string[];
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  homeworkFiles: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
};

export type CabinetLivesState = {
  current: number;
  max: number;
  accessBlocked: boolean;
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
  /** Действующие продуктовые доступы. */
  accesses: CabinetAccess[];
  /** Продукты, которые когда-либо выдавались (включая expired/cancelled). */
  accessHistory: CabinetAccessProduct[];
  enrollment: CabinetEnrollment | null;
  /** Активный курс школы для preview и записи (из courses). */
  courseCatalog: CabinetCourseCatalog | null;
  /** Все доступные курсы — для переключателя, когда их станет больше одного. */
  courseCatalogs?: CabinetCourseCatalog[];
  /** Контент курса из Sanity (структура модулей/уроков). */
  courseContent: DistrictCourseContent | null;
  mentors: CabinetMentor[];
  /** Ind/group: были занятия в scheduled_lessons (для gate без полной загрузки lessons). */
  hasOrdinaryStudentTrack: boolean;
  packages: CabinetPackage[];
  payments: CabinetPayment[];
  profile: CabinetProfile | null;
  courseProgress: CabinetCourseProgress[];
  courseModules: CabinetCourseModule[];
  courseStops: CabinetCourseStop[];
  lives: CabinetLivesState | null;
  /** Цены пакетов курса / индивидуальных / групповых из Sanity. */
  cabinetPricing: CabinetPricing;
  /** Нажал «Посмотреть карту курса» в превью (student_profiles.course_map_viewed_at). */
  courseMapViewed: boolean;
  /** Все роли участника: основная + extra_roles. */
  memberRoles: BotRole[];
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

/** Оплата курса: доступ product=course или активный пакет занятий курса. */
export function hasCoursePayment(data: Pick<CabinetData, 'accesses' | 'packages'>): boolean {
  if (data.accesses.some((a) => a.product === 'course')) return true;
  return data.packages.some((p) => p.product === 'course' && p.active && p.total > 0);
}

/** Превью скрывается после клика «Посмотреть карту» или если курс уже оплачен. */
export function hasViewedCourseMap(data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages'>): boolean {
  return data.courseMapViewed || hasCoursePayment(data);
}

/** preview — первый визит; enrolled_locked — карта без оплаты; full — есть оплата курса. */
export function getCourseCabinetState(
  data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages'>,
): CourseCabinetState {
  if (!hasViewedCourseMap(data)) return 'preview';
  if (!hasCoursePayment(data)) return 'enrolled_locked';
  return 'full';
}

/** «Записан на курс» = оплатил (есть пакет / доступ), не клик по превью. */
export function isEnrolledOnCourse(data: Pick<CabinetData, 'accesses' | 'packages'>): boolean {
  return hasCoursePayment(data);
}

/** Куратор показывается только при полном доступе или при 0 жизнях. */
export function shouldShowCourseCurator(data: CabinetData): boolean {
  const state = getCourseCabinetState(data);
  if (state === 'full') return !!data.mentors.find((m) => m.kind === 'curator');
  if (data.lives?.accessBlocked) return !!data.mentors.find((m) => m.kind === 'curator');
  return false;
}

/** В Sanity/Supabase есть предложение онлайн-курса для кабинета. */
export function hasCourseCatalogOffer(data: Pick<CabinetData, 'courseCatalog' | 'courseContent'>): boolean {
  if (data.courseCatalog) return true;
  return (data.courseContent?.modules.length ?? 0) > 0;
}

/** Ученик начал путь онлайн-курса (запись, оплата или открытие карты). */
export function hasStartedCourseCabinetTrack(
  data: Pick<CabinetData, 'courseMapViewed' | 'accesses' | 'packages' | 'enrollment'>,
): boolean {
  if (data.enrollment != null) return true;
  if (hasCoursePayment(data)) return true;
  return data.courseMapViewed;
}

/**
 * Экран «кабинет только для курса»: ind/group без онлайн-курса
 * или нет данных каталога — не показываем карту/превью.
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
  course: 'Курс District',
  individual: 'Индивидуальные занятия',
  group: 'Групповые занятия',
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
  if (!iso) return '—';
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

/** Fallback карты из preview-модулей каталога, если Sanity-уроки недоступны. */
export function buildModulePreviewsFromContent(
  courseContent: DistrictCourseContent | null,
): CabinetCourseModulePreview[] {
  if (!courseContent) return [];
  return courseContent.modules.map((m) => {
    const visibleLessons = m.lessons.filter((l) => l.publicationStatus !== 'archived');
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

/** URL страницы занятия — Sanity ID или порядковый номер на карте. */
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
        : Array.from({ length: Math.max(mod.count, 1) }, (_, i) => ({ title: `Занятие ${i + 1}` }));
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
        date: mod.period ?? '—',
        sessionStartsAt: null,
        liveUrl: null,
        recordingUrl: null,
        webinarSessionStatus: null,
        mandatoryHomework: false,
        homeworkStatus: null,
        homeworkTitle: null,
        homeworkReviewNote: null,
        homeworkCompletedAt: null,
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

export async function getCabinetData(phone: string, createdAt: string): Promise<CabinetData> {
  const empty: CabinetData = {
    phone,
    createdAt,
    studentName: null,
    telegramLinked: false,
    accesses: [],
    accessHistory: [],
    enrollment: null,
    courseCatalog: null,
    courseContent: null,
    mentors: [],
    hasOrdinaryStudentTrack: false,
    packages: [],
    payments: [],
    profile: null,
    courseProgress: [],
    courseModules: [],
    courseStops: [],
    lives: null,
    cabinetPricing: await getCabinetPricing(),
    courseMapViewed: false,
    memberRoles: ['guest'],
  };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Supabase service role не настроен — не роняем кабинет.
    return empty;
  }

  // Привязка телефона к Telegram.
  const { data: link, error: linkError } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (linkError || !link?.telegram_id) return empty;
  const telegramId = link.telegram_id as number;

  // Имя и роли участника из профиля бота.
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

  // Активные продуктовые доступы.
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

  // Контент курса из Sanity + запись courses в Supabase (без seed уроков).
  let courseContent: DistrictCourseContent | null = null;
  let cabinetPricing: CabinetPricing;
  try {
    [courseContent, cabinetPricing] = await Promise.all([
      getDistrictCourseContent(),
      getCabinetPricing(),
    ]);
  } catch (error) {
    console.error('[cabinet] Sanity fetch failed:', error);
    courseContent = null;
    try {
      cabinetPricing = await getCabinetPricing();
    } catch {
      cabinetPricing = DEFAULT_CABINET_PRICING;
    }
  }

  let courseCatalog: CabinetCourseCatalog | null = null;
  let resolvedCourseId: number | null = null;
  try {
    resolvedCourseId = await resolveCourseIdForContent(admin, courseContent);
  } catch {
    resolvedCourseId = null;
  }

  if (resolvedCourseId) {
    const { data: catalogRow } = await admin
      .from('courses')
      .select('id, title, slug, description, sanity_id')
      .eq('id', resolvedCourseId)
      .maybeSingle();

    if (catalogRow) {
      const modulePreviews = buildModulePreviewsFromContent(courseContent);

      courseCatalog = {
        id: catalogRow.id as number,
        title: (courseContent?.title ?? catalogRow.title) as string,
        slug: (courseContent?.slug ?? catalogRow.slug) as string,
        description: courseContent?.description?.trim() || null,
        cabinetEyebrow: courseContent?.cabinetEyebrow ?? null,
        deliveryFormat: courseContent?.deliveryFormat ?? null,
        homeworkIntro: courseContent?.homeworkIntro ?? null,
        coverImageUrl: courseContent?.coverImageUrl ?? null,
        previewImageUrl: courseContent?.previewImageUrl ?? null,
        previewInsideItems: courseContent?.previewInsideItems ?? [],
        previewAfterEnrollment: courseContent?.previewAfterEnrollment ?? null,
        previewAudience: courseContent?.previewAudience ?? null,
        sanityId: (catalogRow.sanity_id as string | null) ?? courseContent?.sanityId ?? null,
        curatorName: courseContent?.curatorName ?? null,
        totalLessons: courseContent ? countCourseLessons(courseContent) : 0,
        modulePreviews,
      };
    }
  }

  // Активное зачисление на курс.
  const { data: enrollmentRows, error: enrollmentError } = await admin
    .from('course_enrollments')
    .select('status, started_at, course_id, courses(title)')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: false })
    .limit(1);
  let enrollment: CabinetEnrollment | null = null;
  let enrolledCourseId: number | null = null;
  if (!enrollmentError && enrollmentRows?.[0]) {
    const row = enrollmentRows[0];
    enrolledCourseId = row.course_id as number;
    const coursesRaw = row.courses as { title?: string } | { title?: string }[] | null;
    const joinedTitle = Array.isArray(coursesRaw) ? coursesRaw[0]?.title : coursesRaw?.title;
    enrollment = {
      courseId: enrolledCourseId,
      courseTitle: joinedTitle ?? courseCatalog?.title ?? 'Курс District',
      status: row.status,
      startedAt: row.started_at,
    };
  }

  // Активные наставники (преподаватель/куратор).
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

  const courseIdForMap = enrolledCourseId ?? resolvedCourseId ?? courseCatalog?.id ?? null;

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
        withProgress: Boolean(viewedCourseMap && courseIdForMap),
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
        };
      }
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }
  }

  return {
    phone,
    createdAt,
    studentName,
    telegramLinked: true,
    accesses,
    accessHistory,
    enrollment,
    courseCatalog,
    courseContent,
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
    courseMapViewed,
    memberRoles,
  };
}

export type CabinetLessonPageData = {
  courseCatalog: CabinetCourseCatalog | null;
  courseModules: CabinetCourseModule[];
  stop: CabinetCourseStop;
  courseState: CourseCabinetState;
};

/** Облегчённая загрузка для страницы одного занятия (без платежей, расписания и т.д.). */
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

  const { data: link, error: linkError } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (linkError || !link?.telegram_id) return null;
  const telegramId = link.telegram_id as number;

  let courseContent: DistrictCourseContent | null = null;
  try {
    courseContent = await getDistrictCourseContent();
  } catch {
    courseContent = null;
  }

  let resolvedCourseId: number | null = null;
  try {
    resolvedCourseId = await resolveCourseIdForContent(admin, courseContent);
  } catch {
    resolvedCourseId = null;
  }

  let courseCatalog: CabinetCourseCatalog | null = null;
  if (resolvedCourseId) {
    const { data: catalogRow } = await admin
      .from('courses')
      .select('id, title, slug, description, sanity_id')
      .eq('id', resolvedCourseId)
      .maybeSingle();

    if (catalogRow) {
      courseCatalog = {
        id: catalogRow.id as number,
        title: (courseContent?.title ?? catalogRow.title) as string,
        slug: (courseContent?.slug ?? catalogRow.slug) as string,
        description: courseContent?.description?.trim() || null,
        cabinetEyebrow: courseContent?.cabinetEyebrow ?? null,
        deliveryFormat: courseContent?.deliveryFormat ?? null,
        homeworkIntro: courseContent?.homeworkIntro ?? null,
        coverImageUrl: courseContent?.coverImageUrl ?? null,
        previewImageUrl: courseContent?.previewImageUrl ?? null,
        previewInsideItems: courseContent?.previewInsideItems ?? [],
        previewAfterEnrollment: courseContent?.previewAfterEnrollment ?? null,
        previewAudience: courseContent?.previewAudience ?? null,
        sanityId: (catalogRow.sanity_id as string | null) ?? courseContent?.sanityId ?? null,
        curatorName: courseContent?.curatorName ?? null,
        totalLessons: courseContent ? countCourseLessons(courseContent) : 0,
        modulePreviews: buildModulePreviewsFromContent(courseContent),
      };
    }
  }

  const [{ data: enrollmentRows }, { data: accessRows }, { data: packageRows }, profileLoad] =
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
      loadProfile(admin, telegramId).catch(() => ({ profile: null, courseMapViewed: false })),
    ]);

  const enrollment = enrollmentRows?.[0] ?? null;
  const enrolledCourseId = (enrollment?.course_id as number) ?? null;
  const accesses: CabinetAccess[] = (accessRows ?? [])
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
  const courseMapViewed = profileLoad.courseMapViewed;
  const cabinetSlice = { courseMapViewed, accesses, packages };
  const courseState = getCourseCabinetState(cabinetSlice);
  const hasCourseProductAccess = hasCoursePayment(cabinetSlice);
  const viewedCourseMap = hasViewedCourseMap(cabinetSlice);

  const courseIdForMap = enrolledCourseId ?? resolvedCourseId ?? courseCatalog?.id ?? null;
  let courseModules: CabinetCourseModule[] = [];
  let courseStops: CabinetCourseStop[] = [];

  if (courseContent?.modules.length && courseIdForMap) {
    try {
      const mapData = await resolveCourseMapFromContent(admin, telegramId, courseIdForMap, courseContent, {
        courseState,
        hasCourseProductAccess,
        withProgress: Boolean(viewedCourseMap && courseIdForMap),
      });
      courseModules = mapData.modules;
      courseStops = mapData.stops;
    } catch {
      courseModules = mapContentToCourseModules(courseContent);
      courseStops = mapContentToStructureStops(courseContent);
    }
    if (courseStops.length === 0) {
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
    } catch {
      // fallback ниже
    }
  }

  if (courseStops.length === 0 && courseCatalog) {
    courseStops = buildStopsFromCatalogPreviews(courseCatalog);
    courseModules = buildModulesFromCatalogPreviews(courseCatalog);
  }

  if (courseState === 'preview') {
    redirect('/cabinet?section=course');
  }

  const stop = findCabinetStopByLessonParam(courseStops, lessonId);
  if (!stop) notFound();

  return {
    courseCatalog,
    courseModules,
    stop,
    courseState,
  };
}
