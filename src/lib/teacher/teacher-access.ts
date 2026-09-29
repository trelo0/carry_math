import type { SupabaseClient } from '@supabase/supabase-js';

/** Ученик связан с teacher через его занятия или группы. */
export async function teacherOwnsStudent(
  admin: SupabaseClient,
  teacherTelegramId: number,
  studentTelegramId: number,
): Promise<boolean> {
  const { count: lessonCount } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('telegram_id', studentTelegramId);
  if ((lessonCount ?? 0) > 0) return true;

  const { count: assignCount } = await admin
    .from('mentor_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('mentor_telegram_id', teacherTelegramId)
    .eq('telegram_id', studentTelegramId)
    .eq('kind', 'teacher')
    .eq('status', 'active');
  if ((assignCount ?? 0) > 0) return true;

  const { data: groups } = await admin
    .from('groups')
    .select('id')
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('status', 'active');
  const groupIds = (groups ?? []).map((g) => g.id as number);
  if (groupIds.length === 0) return false;

  const { count: memberCount } = await admin
    .from('group_members')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', studentTelegramId)
    .eq('status', 'active')
    .in('group_id', groupIds);
  return (memberCount ?? 0) > 0;
}
