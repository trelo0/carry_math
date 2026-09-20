import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessProduct } from './accesses';

export type PurchaseFulfillmentSnapshot = {
  userAccess: { product: AccessProduct; status: string; expiresAt: string | null } | null;
  lessonPackage: { id: number; title: string; remaining: number; total: number; status: string } | null;
  payment: { id: number; amountByn: number; externalId: string | null } | null;
  enrollment: { courseId: number; status: string } | null;
  curator: { mentorTelegramId: number; mentorName: string | null } | null;
  lessonAccessCount: number;
};

export function formatPurchaseFulfillmentSnapshot(snapshot: PurchaseFulfillmentSnapshot): string[] {
  const lines: string[] = ['📋 Проверка выдачи:', ''];

  if (snapshot.userAccess) {
    lines.push(
      `✅ user_accesses: ${snapshot.userAccess.product} · ${snapshot.userAccess.status}`,
    );
  } else {
    lines.push('❌ user_accesses: не найден');
  }

  if (snapshot.lessonPackage) {
    lines.push(
      `✅ lesson_packages: #${snapshot.lessonPackage.id} · ${snapshot.lessonPackage.remaining}/${snapshot.lessonPackage.total} · ${snapshot.lessonPackage.status}`,
    );
  } else {
    lines.push('❌ lesson_packages: не найден');
  }

  if (snapshot.payment) {
    lines.push(
      `✅ payments: #${snapshot.payment.id} · ${snapshot.payment.amountByn} BYN` +
        (snapshot.payment.externalId ? ` · ${snapshot.payment.externalId}` : ''),
    );
  } else {
    lines.push('❌ payments: не найден');
  }

  if (snapshot.enrollment) {
    lines.push(
      `✅ course_enrollments: курс #${snapshot.enrollment.courseId} · ${snapshot.enrollment.status}`,
    );
  }

  if (snapshot.curator) {
    lines.push(
      `✅ mentor_assignments: куратор ${snapshot.curator.mentorName ?? snapshot.curator.mentorTelegramId}`,
    );
  } else {
    lines.push('⚠️ mentor_assignments: куратор не назначен');
  }

  lines.push(`📚 course_lesson_access: ${snapshot.lessonAccessCount} урок(ов)`);

  return lines;
}

export async function loadPurchaseFulfillmentSnapshot(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  packageId: number,
  externalId?: string,
): Promise<PurchaseFulfillmentSnapshot> {
  const [{ data: access }, { data: pkg }, paymentQuery, { data: enrollment }, { data: curator }] =
    await Promise.all([
      admin
        .from('user_accesses')
        .select('product, status, expires_at')
        .eq('telegram_id', telegramId)
        .eq('product', product)
        .maybeSingle(),
      admin
        .from('lesson_packages')
        .select('id, title, remaining_lessons, total_lessons, status')
        .eq('id', packageId)
        .maybeSingle(),
      externalId
        ? admin
            .from('payments')
            .select('id, amount_byn, external_id')
            .eq('external_id', externalId)
            .maybeSingle()
        : admin
            .from('payments')
            .select('id, amount_byn, external_id')
            .eq('telegram_id', telegramId)
            .eq('package_id', packageId)
            .order('paid_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
      product === 'course'
        ? admin
            .from('course_enrollments')
            .select('course_id, status')
            .eq('telegram_id', telegramId)
            .eq('status', 'active')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      product === 'course'
        ? admin
            .from('mentor_assignments')
            .select('mentor_telegram_id')
            .eq('telegram_id', telegramId)
            .eq('kind', 'curator')
            .eq('status', 'active')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const payment = paymentQuery.data;

  let mentorName: string | null = null;
  if (curator?.mentor_telegram_id) {
    const { data: member } = await admin
      .from('bot_members')
      .select('full_name')
      .eq('telegram_id', curator.mentor_telegram_id)
      .maybeSingle();
    mentorName = member?.full_name ?? null;
  }

  const { count: lessonAccessCount } = await admin
    .from('course_lesson_access')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('access_status', 'available');

  return {
    userAccess: access
      ? {
          product: access.product as AccessProduct,
          status: access.status as string,
          expiresAt: (access.expires_at as string | null) ?? null,
        }
      : null,
    lessonPackage: pkg
      ? {
          id: pkg.id as number,
          title: pkg.title as string,
          remaining: pkg.remaining_lessons as number,
          total: pkg.total_lessons as number,
          status: pkg.status as string,
        }
      : null,
    payment: payment
      ? {
          id: payment.id as number,
          amountByn: Number(payment.amount_byn),
          externalId: (payment.external_id as string | null) ?? null,
        }
      : null,
    enrollment: enrollment
      ? {
          courseId: enrollment.course_id as number,
          status: enrollment.status as string,
        }
      : null,
    curator: curator?.mentor_telegram_id
      ? {
          mentorTelegramId: curator.mentor_telegram_id as number,
          mentorName,
        }
      : null,
    lessonAccessCount: lessonAccessCount ?? 0,
  };
}
