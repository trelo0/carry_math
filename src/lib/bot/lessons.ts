import type { SupabaseClient } from '@supabase/supabase-js';

export type ScheduledLessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

/** Завершение назначенного ind/group занятия — единственный момент списания из пакета. */
export async function completeScheduledLesson(
  admin: SupabaseClient,
  lessonId: number,
  completedByTelegramId: number,
): Promise<{ consumed: boolean }> {
  const { data: lesson, error: loadError } = await admin
    .from('scheduled_lessons')
    .select('id, status, package_id, consumed_at')
    .eq('id', lessonId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!lesson) throw new Error(`Занятие ${lessonId} не найдено.`);
  if (lesson.status === 'completed' && lesson.consumed_at) {
    return { consumed: false };
  }

  const now = new Date().toISOString();
  const shouldConsume = lesson.status !== 'cancelled';

  const { error: updateError } = await admin
    .from('scheduled_lessons')
    .update({
      status: 'completed',
      completed_at: now,
      completed_by: completedByTelegramId,
      consumed_at: shouldConsume && !lesson.consumed_at ? now : lesson.consumed_at,
      updated_at: now,
    })
    .eq('id', lessonId);
  if (updateError) throw updateError;

  if (!shouldConsume || !lesson.package_id || lesson.consumed_at) {
    return { consumed: false };
  }

  const packageId = lesson.package_id as number;
  const { data: pkg, error: pkgError } = await admin
    .from('lesson_packages')
    .select('id, total_lessons, used_lessons, remaining_lessons, status')
    .eq('id', packageId)
    .single();
  if (pkgError) throw pkgError;

  const used = (pkg.used_lessons as number) + 1;
  const remaining = Math.max(0, (pkg.total_lessons as number) - used);
  const { error: pkgUpdateError } = await admin
    .from('lesson_packages')
    .update({
      used_lessons: used,
      remaining_lessons: remaining,
      status: remaining <= 0 ? 'completed' : 'active',
      updated_at: now,
    })
    .eq('id', packageId);
  if (pkgUpdateError) throw pkgUpdateError;

  return { consumed: true };
}

/** Отмена до проведения — урок не списывается. */
export async function cancelScheduledLesson(
  admin: SupabaseClient,
  lessonId: number,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('scheduled_lessons')
    .update({ status: 'cancelled', updated_at: now })
    .eq('id', lessonId)
    .eq('status', 'scheduled');
  if (error) throw error;
}

/** Пересчёт remaining из фактически завершённых занятий пакета. */
export async function syncPackageUsage(
  admin: SupabaseClient,
  packageId: number,
): Promise<void> {
  const { data: pkg, error: pkgError } = await admin
    .from('lesson_packages')
    .select('id, total_lessons')
    .eq('id', packageId)
    .single();
  if (pkgError) throw pkgError;

  const { count, error: countError } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId)
    .not('consumed_at', 'is', null);
  if (countError) throw countError;

  const used = count ?? 0;
  const total = pkg.total_lessons as number;
  const remaining = Math.max(0, total - used);
  const now = new Date().toISOString();

  const { error } = await admin
    .from('lesson_packages')
    .update({
      used_lessons: used,
      remaining_lessons: remaining,
      status: remaining <= 0 ? 'completed' : 'active',
      updated_at: now,
    })
    .eq('id', packageId);
  if (error) throw error;
}

export async function scheduleLesson(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    kind: 'individual' | 'group';
    startsAt: string;
    topic: string;
    packageId: number;
    teacherTelegramId?: number;
    groupId?: number;
    durationMinutes?: number;
    meetUrl?: string;
  },
): Promise<number> {
  const { data: pkg, error: pkgError } = await admin
    .from('lesson_packages')
    .select('id, remaining_lessons, status')
    .eq('id', params.packageId)
    .single();
  if (pkgError) throw pkgError;
  if (pkg.status !== 'active' || (pkg.remaining_lessons as number) <= 0) {
    throw new Error('В пакете не осталось занятий для назначения.');
  }

  const { data, error } = await admin
    .from('scheduled_lessons')
    .insert({
      telegram_id: params.telegramId,
      kind: params.kind,
      group_id: params.groupId ?? null,
      package_id: params.packageId,
      teacher_telegram_id: params.teacherTelegramId ?? null,
      starts_at: params.startsAt,
      duration_minutes: params.durationMinutes ?? 60,
      topic: params.topic,
      status: 'scheduled',
      meet_url: params.meetUrl ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

export type UpcomingLessonRow = {
  id: number;
  kind: 'individual' | 'group';
  topic: string;
  startsAt: string;
  meetUrl: string | null;
};

/** Ближайшее запланированное занятие ученика. */
export async function getNextScheduledLesson(
  admin: SupabaseClient,
  telegramId: number,
): Promise<UpcomingLessonRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select('id, kind, topic, starts_at, meet_url')
    .eq('telegram_id', telegramId)
    .eq('status', 'scheduled')
    .gte('starts_at', now)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as number,
    kind: data.kind as 'individual' | 'group',
    topic: data.topic as string,
    startsAt: data.starts_at as string,
    meetUrl: (data.meet_url as string | null) ?? null,
  };
}
