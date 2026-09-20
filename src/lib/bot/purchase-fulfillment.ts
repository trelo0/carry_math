import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccessProduct, isAccessProduct } from './accesses';
import { completeProductPurchase, isPackageTableError } from './packages';
import {
  formatPurchaseFulfillmentSnapshot,
  loadPurchaseFulfillmentSnapshot,
  type PurchaseFulfillmentSnapshot,
} from './purchase-verification';
import {
  countPublishedLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  getCabinetPricing,
  priceForTeacher,
  type CabinetPricing,
} from '@/lib/studio/cabinetSettings';

export type PurchaseFulfillInput = {
  product: AccessProduct;
  /** Индекс пакета в Sanity (individual/group). Для course — 0. */
  packageIndex?: number;
  /** Преподаватель для individual/group. */
  teacherId?: string;
  /** Idempotency key (будет у платёжки). */
  externalId?: string;
  courseId?: number;
  curatorTelegramId?: number;
  expiresAt?: string | null;
};

export type ResolvedPurchaseOffer = {
  product: AccessProduct;
  title: string;
  lessons: number;
  amountByn: number;
  teacherId?: string;
  teacherName?: string;
};

export class PurchaseFulfillError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_PRODUCT' | 'INVALID_PACKAGE' | 'INVALID_TEACHER' | 'INVALID_PRICE' | 'ALREADY_FULFILLED' | 'NOT_LINKED',
  ) {
    super(message);
    this.name = 'PurchaseFulfillError';
  }
}

/** Первое число из названия пакета: «4 занятия» → 4. */
export function parseLessonCountFromPackageName(name: string): number | null {
  const match = name.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function resolveTelegramIdByPhone(
  admin: SupabaseClient,
  phone: string,
): Promise<number | null> {
  const { data } = await admin.from('telegram_links').select('telegram_id').eq('phone', phone).maybeSingle();
  return data?.telegram_id ?? null;
}

async function findPaymentByExternalId(
  admin: SupabaseClient,
  externalId: string,
): Promise<{ packageId: number | null } | null> {
  try {
    const { data } = await admin
      .from('payments')
      .select('package_id')
      .eq('external_id', externalId)
      .maybeSingle();
    if (!data) return null;
    return { packageId: (data.package_id as number | null) ?? null };
  } catch (error) {
    if (!isPackageTableError(error)) throw error;
    return null;
  }
}

export async function resolvePurchaseOffer(
  pricing: CabinetPricing,
  input: PurchaseFulfillInput,
  options?: { courseLessonCount?: number | null },
): Promise<ResolvedPurchaseOffer> {
  if (!isAccessProduct(input.product)) {
    throw new PurchaseFulfillError('Неизвестный продукт', 'INVALID_PRODUCT');
  }

  if (input.product === 'course') {
    const offer = pricing.course.offer;
    const lessons =
      options?.courseLessonCount && options.courseLessonCount > 0
        ? options.courseLessonCount
        : 1;
    return {
      product: 'course',
      title: pricing.course.label,
      lessons,
      amountByn: offer.priceByn,
    };
  }

  const pack = pricing[input.product];
  const packageIndex = input.packageIndex ?? 0;
  const option = pack.options[packageIndex];
  if (!option) {
    throw new PurchaseFulfillError(`Пакет с индексом ${packageIndex} не найден`, 'INVALID_PACKAGE');
  }

  const teacherId = input.teacherId ?? pricing.teachers[0]?.teacherId;
  if (!teacherId) {
    throw new PurchaseFulfillError('Не указан преподаватель', 'INVALID_TEACHER');
  }

  const teacher = pricing.teachers.find((t) => t.teacherId === teacherId);
  if (!teacher) {
    throw new PurchaseFulfillError(`Преподаватель «${teacherId}» не найден`, 'INVALID_TEACHER');
  }

  const amountByn = priceForTeacher(option, teacherId, pricing.teachers);
  if (amountByn == null) {
    throw new PurchaseFulfillError(`Нет цены для преподавателя «${teacherId}»`, 'INVALID_PRICE');
  }

  const lessons = parseLessonCountFromPackageName(option.name);
  if (!lessons) {
    throw new PurchaseFulfillError(`Не удалось определить число занятий в «${option.name}»`, 'INVALID_PACKAGE');
  }

  return {
    product: input.product,
    title: `${pack.label} · ${option.name} · ${teacher.name}`,
    lessons,
    amountByn,
    teacherId,
    teacherName: teacher.name,
  };
}

/** Выдача доступа после оплаты. Вызывается вручную до эквайринга и из webhook позже. */
export async function fulfillPurchase(
  admin: SupabaseClient,
  telegramId: number,
  input: PurchaseFulfillInput,
): Promise<{
  packageId: number;
  offer: ResolvedPurchaseOffer;
  alreadyFulfilled: boolean;
  snapshot: PurchaseFulfillmentSnapshot;
  verificationLines: string[];
}> {
  if (input.externalId) {
    const existing = await findPaymentByExternalId(admin, input.externalId);
    if (existing?.packageId) {
      const pricing = await getCabinetPricing();
      const courseContent = input.product === 'course' ? await getDistrictCourseContent().catch(() => null) : null;
      const offer = await resolvePurchaseOffer(pricing, input, {
        courseLessonCount: courseContent ? countPublishedLessons(courseContent) : null,
      });
      const snapshot = await loadPurchaseFulfillmentSnapshot(
        admin,
        telegramId,
        input.product,
        existing.packageId,
        input.externalId,
      );
      return {
        packageId: existing.packageId,
        offer,
        alreadyFulfilled: true,
        snapshot,
        verificationLines: formatPurchaseFulfillmentSnapshot(snapshot),
      };
    }
  }

  const pricing = await getCabinetPricing();
  const courseContent = input.product === 'course' ? await getDistrictCourseContent().catch(() => null) : null;
  const courseLessonCount = courseContent ? countPublishedLessons(courseContent) : null;

  const offer = await resolvePurchaseOffer(pricing, input, { courseLessonCount });

  const { packageId } = await completeProductPurchase(admin, telegramId, input.product, {
    title: offer.title,
    lessons: offer.lessons,
    amountByn: offer.amountByn,
    expiresAt: input.expiresAt ?? null,
    externalId: input.externalId,
    courseId: input.courseId,
    curatorTelegramId: input.curatorTelegramId,
    teacherSanityId: input.teacherId,
  });

  const snapshot = await loadPurchaseFulfillmentSnapshot(
    admin,
    telegramId,
    input.product,
    packageId,
    input.externalId,
  );

  return {
    packageId,
    offer,
    alreadyFulfilled: false,
    snapshot,
    verificationLines: formatPurchaseFulfillmentSnapshot(snapshot),
  };
}

export { formatPurchaseFulfillmentSnapshot, loadPurchaseFulfillmentSnapshot };
export type { PurchaseFulfillmentSnapshot };

export async function fulfillPurchaseByPhone(
  admin: SupabaseClient,
  phone: string,
  input: PurchaseFulfillInput,
): Promise<{ telegramId: number; packageId: number; offer: ResolvedPurchaseOffer; alreadyFulfilled: boolean }> {
  const telegramId = await resolveTelegramIdByPhone(admin, phone);
  if (!telegramId) {
    throw new PurchaseFulfillError(`Telegram не привязан к ${phone}`, 'NOT_LINKED');
  }
  const result = await fulfillPurchase(admin, telegramId, input);
  return { telegramId, ...result };
}
