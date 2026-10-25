import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserContext, type AccessProduct } from './accesses';
import { isPackageTableError } from './packages';
import type { BotRole } from './roles';
import { CLIENT_LESSONS_BOT_UI_ENABLED } from './client-lessons-ui-flag';

/** Пользовательское состояние меню (не путать с bot_members.role). */
export type ClientUiPhase = 'guest' | 'client_idle' | 'client_active';

export type ClientProductFlags = Record<AccessProduct, boolean>;

export type ClientStateSnapshot = {
  phase: ClientUiPhase;
  telegramId: number;
  products: ClientProductFlags;
  hasActiveProducts: boolean;
  hasLessonHistory: boolean;
  hasUpcomingLessons: boolean;
  isIdentifiedClient: boolean;
  telegramLinked: boolean;
  /** Активный ind/group пакет с остатком или доступом. */
  hasActiveLessonProduct: boolean;
  hasActiveCourse: boolean;
};

/** Режим активного меню по купленным продуктам. */
export type ClientProductMode = 'none' | 'lessons' | 'course' | 'both';

export function getClientProductMode(state: ClientStateSnapshot): ClientProductMode {
  if (!CLIENT_LESSONS_BOT_UI_ENABLED) {
    return state.hasActiveCourse ? 'course' : 'none';
  }
  if (state.hasActiveCourse && state.hasActiveLessonProduct) return 'both';
  if (state.hasActiveCourse) return 'course';
  if (state.hasActiveLessonProduct) return 'lessons';
  return 'none';
}

function isCabinetTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const code = String(details?.code ?? '');
  const message = String(details?.message ?? error);
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('does not exist') || message.includes('Could not find');
}

export function usesClientBotUi(effectiveRole: BotRole): boolean {
  return effectiveRole === 'guest' || effectiveRole === 'student';
}

export async function resolveClientState(
  admin: SupabaseClient,
  telegramId: number,
  options?: { memberRole?: BotRole },
): Promise<ClientStateSnapshot> {
  const context = await getUserContext(admin, telegramId);
  const products: ClientProductFlags = {
    course: context?.accesses.course ?? false,
    individual: context?.accesses.individual ?? false,
    group: context?.accesses.group ?? false,
  };

  let telegramLinked = false;
  let hasLessonHistory = false;
  let hasUpcomingLessons = false;
  let hasPackageHistory = false;
  let hasAccessHistory = false;
  let hasPurchaseHistory = false;
  let activePackageLessons = false;
  let hasCoursePackage = false;
  let hasCourseEnrollment = false;

  const now = new Date().toISOString();

  try {
    const [
      linkRes,
      historyCountRes,
      upcomingCountRes,
      packagesRes,
      accessesRes,
      purchaseRes,
      activePkgRes,
      coursePkgRes,
      courseEnrollRes,
    ] = await Promise.all([
      admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
      admin
        .from('scheduled_lessons')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .neq('status', 'cancelled'),
      admin
        .from('scheduled_lessons')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .eq('status', 'scheduled')
        .gte('starts_at', now),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .gt('total_lessons', 0),
      admin.from('user_accesses').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId),
      admin
        .from('purchase_requests')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .in('product', ['individual', 'group'])
        .eq('status', 'active')
        .gt('remaining_lessons', 0),
      admin
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .eq('product', 'course')
        .eq('status', 'active'),
      admin
        .from('course_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('telegram_id', telegramId)
        .eq('status', 'active'),
    ]);

    telegramLinked = Boolean(linkRes.data?.phone);
    hasLessonHistory = (historyCountRes.count ?? 0) > 0;
    hasUpcomingLessons = (upcomingCountRes.count ?? 0) > 0;
    hasPackageHistory = (packagesRes.count ?? 0) > 0;
    hasAccessHistory = (accessesRes.count ?? 0) > 0;
    hasPurchaseHistory = (purchaseRes.count ?? 0) > 0;
    activePackageLessons = (activePkgRes.count ?? 0) > 0;
    hasCoursePackage = (coursePkgRes.count ?? 0) > 0;
    hasCourseEnrollment = (courseEnrollRes.count ?? 0) > 0;
  } catch (error) {
    if (!isCabinetTableError(error) && !isPackageTableError(error)) throw error;
  }

  const hasActiveCourse = products.course || hasCoursePackage || hasCourseEnrollment;
  const hasActiveLessonProduct =
    products.individual || products.group || activePackageLessons;
  const hasActiveProducts =
    hasActiveCourse ||
    (CLIENT_LESSONS_BOT_UI_ENABLED && hasActiveLessonProduct);

  const memberRole = options?.memberRole ?? 'guest';
  /** Учёт в кабинете/боте как student — отдельный сценарий от чистого guest. */
  const isRegisteredStudent = memberRole === 'student';
  const isIdentifiedClient =
    isRegisteredStudent ||
    telegramLinked ||
    hasAccessHistory ||
    hasPackageHistory ||
    hasLessonHistory ||
    hasPurchaseHistory;

  let phase: ClientUiPhase = 'guest';
  /** Маска guest (/role me guest) — всегда гостевой сценарий, даже при активных пакетах. */
  if (memberRole === 'guest') {
    phase = 'guest';
  } else if (hasActiveProducts) phase = 'client_active';
  else if (isRegisteredStudent) phase = 'client_idle';
  else if (isIdentifiedClient) phase = 'client_idle';

  return {
    phase,
    telegramId,
    products,
    hasActiveProducts,
    hasLessonHistory,
    hasUpcomingLessons,
    isIdentifiedClient,
    telegramLinked,
    hasActiveLessonProduct,
    hasActiveCourse,
  };
}
