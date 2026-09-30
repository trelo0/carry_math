import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserContext, type AccessProduct } from './accesses';
import type { BotRole } from './roles';

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
        .eq('status', 'active')
        .gt('remaining_lessons', 0),
    ]);

    telegramLinked = Boolean(linkRes.data?.phone);
    hasLessonHistory = (historyCountRes.count ?? 0) > 0;
    hasUpcomingLessons = (upcomingCountRes.count ?? 0) > 0;
    hasPackageHistory = (packagesRes.count ?? 0) > 0;
    hasAccessHistory = (accessesRes.count ?? 0) > 0;
    hasPurchaseHistory = (purchaseRes.count ?? 0) > 0;
    activePackageLessons = (activePkgRes.count ?? 0) > 0;
  } catch (error) {
    if (!isCabinetTableError(error)) throw error;
  }

  const hasActiveCourse = products.course;
  const hasActiveLessonProduct =
    products.individual || products.group || activePackageLessons;
  const hasActiveProducts = hasActiveCourse || hasActiveLessonProduct;

  const memberRole = options?.memberRole;
  const isIdentifiedClient =
    memberRole === 'student' ||
    telegramLinked ||
    hasAccessHistory ||
    hasPackageHistory ||
    hasLessonHistory ||
    hasPurchaseHistory;

  let phase: ClientUiPhase = 'guest';
  if (hasActiveProducts) phase = 'client_active';
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
