import type { SupabaseClient } from '@supabase/supabase-js';

export type StudentPackageCredit = {
  remaining: number;
  total: number;
};

export type StudentPackageCredits = {
  individual: StudentPackageCredit | null;
  group: StudentPackageCredit | null;
};

/** Активный пакет с максимальным остатком по типу (как при автосписании занятия). */
export async function loadStudentPackageCredits(
  admin: SupabaseClient,
  telegramIds: number[],
): Promise<Map<number, StudentPackageCredits>> {
  const result = new Map<number, StudentPackageCredits>();
  if (telegramIds.length === 0) return result;

  const { data, error } = await admin
    .from('lesson_packages')
    .select('telegram_id, product, remaining_lessons, total_lessons, status, purchased_at')
    .in('telegram_id', telegramIds)
    .eq('status', 'active')
    .gt('remaining_lessons', 0);
  if (error) throw error;

  for (const id of telegramIds) {
    result.set(id, { individual: null, group: null });
  }

  const rows = [...(data ?? [])].sort(
    (a, b) => String(b.purchased_at ?? '').localeCompare(String(a.purchased_at ?? '')),
  );

  for (const row of rows) {
    const telegramId = row.telegram_id as number;
    const entry = result.get(telegramId);
    if (!entry) continue;
    const product = row.product as string;
    if (product !== 'individual' && product !== 'group') continue;
    if (entry[product]) continue;
    entry[product] = {
      remaining: row.remaining_lessons as number,
      total: row.total_lessons as number,
    };
  }

  return result;
}

export function formatPackageCreditLine(credit: StudentPackageCredit | null, label: string): string {
  if (!credit) return `${label}: нет активного пакета`;
  return `${label}: ${credit.remaining} из ${credit.total} занятий`;
}
