import type { SupabaseClient } from '@supabase/supabase-js';

export class LessonCreditError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_PACKAGE' | 'PACKAGE_MISMATCH' | 'NO_CREDIT',
  ) {
    super(message);
    this.name = 'LessonCreditError';
  }
}

export type LessonPackageCreditRow = {
  id: number;
  product: string;
  remaining_lessons: number;
  total_lessons: number;
  status: string;
};

export async function resolveActivePackage(
  admin: SupabaseClient,
  telegramId: number,
  kind: 'individual' | 'group',
  packageId?: number,
): Promise<LessonPackageCreditRow> {
  if (packageId != null) {
    const { data, error } = await admin
      .from('lesson_packages')
      .select('id, product, remaining_lessons, total_lessons, status')
      .eq('id', packageId)
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new LessonCreditError(`Пакет ${packageId} не найден у ученика.`, 'NO_PACKAGE');
    }
    if (data.product !== kind) {
      throw new LessonCreditError(
        `Пакет «${data.product}» не подходит для занятия «${kind}».`,
        'PACKAGE_MISMATCH',
      );
    }
    if (data.status !== 'active' || (data.remaining_lessons as number) <= 0) {
      throw new LessonCreditError('В пакете не осталось занятий.', 'NO_CREDIT');
    }
    return data as LessonPackageCreditRow;
  }

  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, product, remaining_lessons, total_lessons, status')
    .eq('telegram_id', telegramId)
    .eq('product', kind)
    .eq('status', 'active')
    .gt('remaining_lessons', 0)
    .order('purchased_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new LessonCreditError(`Нет оплаченных ${kind === 'individual' ? 'индивидуальных' : 'групповых'} занятий.`, 'NO_CREDIT');
  }
  return data as LessonPackageCreditRow;
}

/** Занятия status=scheduled, ещё не списавшие credit (consumed_at null). */
export async function countScheduledLessonsForPackage(
  admin: SupabaseClient,
  packageId: number,
): Promise<number> {
  const { count, error } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId)
    .eq('status', 'scheduled');
  if (error) throw error;
  return count ?? 0;
}

/** Свободный «commit slot»: remaining − уже запланированные scheduled. */
export async function getAvailableCommitSlots(
  admin: SupabaseClient,
  telegramId: number,
  kind: 'individual' | 'group',
  packageId?: number,
): Promise<{ packageId: number; remaining: number; scheduled: number; available: number }> {
  const pkg = await resolveActivePackage(admin, telegramId, kind, packageId);
  const scheduled = await countScheduledLessonsForPackage(admin, pkg.id);
  const available = Math.max(0, (pkg.remaining_lessons as number) - scheduled);
  return {
    packageId: pkg.id,
    remaining: pkg.remaining_lessons as number,
    scheduled,
    available,
  };
}

/** Перед созданием scheduled_lesson: есть ли незакреплённый credit. */
export async function assertLessonCreditAvailable(
  admin: SupabaseClient,
  telegramId: number,
  kind: 'individual' | 'group',
  packageId?: number,
): Promise<{ packageId: number }> {
  const slots = await getAvailableCommitSlots(admin, telegramId, kind, packageId);
  if (slots.available <= 0) {
    throw new LessonCreditError(
      kind === 'individual'
        ? 'У ученика больше нет доступных индивидуальных занятий.'
        : 'У ученика больше нет доступных групповых занятий.',
      'NO_CREDIT',
    );
  }
  return { packageId: slots.packageId };
}
