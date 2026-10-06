import type { SupabaseClient } from '@supabase/supabase-js';
import { countViolations, isViolationTableError } from '@/lib/bot/moderation';
import { countPendingPurchaseRequests, isPurchaseRequestTableError } from '@/lib/bot/purchase-requests';

export type AdminHubMetrics = {
  leadsNew: number;
  leadsInProgress: number;
  purchasesPending: number;
  violationsPending: number;
  packagesLow: number;
  homeworkPendingReview: number;
  homeworkLongPending: number;
  membersNew7d: number;
  studentsActive: number;
  studentsPaused: number;
  studentsNew: number;
  lessonsToday: number;
  scheduleProblems: number;
};

async function countLeads(admin: SupabaseClient, status: string): Promise<number> {
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  if (error) {
    const msg = String(error.message ?? error);
    if (msg.includes('leads') && (msg.includes('status') || String((error as { code?: string }).code) === '42703')) {
      const { count: allCount, error: allErr } = await admin
        .from('leads')
        .select('id', { count: 'exact', head: true });
      if (allErr) return 0;
      return status === 'new' ? (allCount ?? 0) : 0;
    }
    throw error;
  }
  return count ?? 0;
}

async function countLowPackages(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('lesson_packages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .lte('remaining_lessons', 2);
  if (error) {
    if (String(error.message ?? '').includes('lesson_packages')) return 0;
    throw error;
  }
  return count ?? 0;
}

async function countHomeworkPendingReview(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('homework_assignments')
    .select('id', { count: 'exact', head: true })
    .in('review_status', ['submitted', 'reviewing']);
  if (error) {
    if (String(error.message ?? '').includes('homework_assignments')) return 0;
    throw error;
  }
  return count ?? 0;
}

const LONG_HW_MS = 3 * 86400000;

async function countHomeworkLongPending(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - LONG_HW_MS).toISOString();
  const { count, error } = await admin
    .from('homework_assignments')
    .select('id', { count: 'exact', head: true })
    .in('review_status', ['submitted', 'reviewing'])
    .lt('submitted_at', cutoff);
  if (error) {
    if (String(error.message ?? '').includes('homework_assignments')) return 0;
    throw error;
  }
  return count ?? 0;
}

async function countLessonsToday(admin: SupabaseClient): Promise<number> {
  const { fromIso, toIso } = moscowDayBounds();
  const { count, error } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso);
  if (error) {
    if (String(error.message ?? '').includes('scheduled_lessons')) return 0;
    throw error;
  }
  return count ?? 0;
}

function moscowDayBounds(): { fromIso: string; toIso: string; dateLabel: string } {
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const now = Date.now();
  const mskMidnight = Math.floor((now + mskOffset) / msDay) * msDay - mskOffset;
  const from = new Date(mskMidnight);
  const to = new Date(mskMidnight + msDay);
  const dateLabel = from.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
  });
  return { fromIso: from.toISOString(), toIso: to.toISOString(), dateLabel };
}

export type TodayLessonRow = {
  id: number;
  starts_at: string;
  kind: string;
  topic: string;
  telegram_id: number;
  group_id: number | null;
};

export async function fetchTodayLessonsPreview(
  admin: SupabaseClient,
  limit = 5,
): Promise<{ dateLabel: string; rows: TodayLessonRow[] }> {
  const { fromIso, toIso, dateLabel } = moscowDayBounds();
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select('id, starts_at, kind, topic, telegram_id, group_id')
    .eq('status', 'scheduled')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (String(error.message ?? '').includes('scheduled_lessons')) {
      return { dateLabel, rows: [] };
    }
    throw error;
  }
  return { dateLabel, rows: (data ?? []) as TodayLessonRow[] };
}

async function countStudentRoleStats(admin: SupabaseClient): Promise<{
  active: number;
  paused: number;
  newStudents: number;
}> {
  const { data: students, error } = await admin
    .from('bot_members')
    .select('telegram_id, created_at')
    .eq('role', 'student');
  if (error) throw error;
  const ids = (students ?? []).map((r) => r.telegram_id as number);
  if (ids.length === 0) return { active: 0, paused: 0, newStudents: 0 };

  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const newStudents = (students ?? []).filter((r) => String(r.created_at) >= since7d).length;

  const activeIds = new Set<number>();
  const [{ data: acc }, { data: pkg }] = await Promise.all([
    admin.from('user_accesses').select('telegram_id').eq('status', 'active').in('telegram_id', ids),
    admin.from('lesson_packages').select('telegram_id').eq('status', 'active').in('telegram_id', ids),
  ]);
  for (const row of acc ?? []) activeIds.add(row.telegram_id as number);
  for (const row of pkg ?? []) activeIds.add(row.telegram_id as number);

  const active = activeIds.size;
  const paused = Math.max(0, ids.length - active);
  return { active, paused, newStudents };
}

async function countScheduleProblems(admin: SupabaseClient): Promise<number> {
  const { countOverbookedPackages } = await import('./problems-menu');
  const overbook = await countOverbookedPackages(admin);
  return overbook;
}

async function countMembersSince7d(admin: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count, error } = await admin
    .from('bot_members')
    .select('telegram_id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchAdminHubMetrics(admin: SupabaseClient): Promise<AdminHubMetrics> {
  const metrics: AdminHubMetrics = {
    leadsNew: 0,
    leadsInProgress: 0,
    purchasesPending: 0,
    violationsPending: 0,
    packagesLow: 0,
    homeworkPendingReview: 0,
    homeworkLongPending: 0,
    membersNew7d: 0,
    studentsActive: 0,
    studentsPaused: 0,
    studentsNew: 0,
    lessonsToday: 0,
    scheduleProblems: 0,
  };

  try {
    metrics.leadsNew = await countLeads(admin, 'new');
    metrics.leadsInProgress = await countLeads(admin, 'in_progress');
  } catch (error) {
    console.error('hub-metrics leads:', error);
  }

  try {
    metrics.purchasesPending = await countPendingPurchaseRequests(admin);
  } catch (error) {
    if (!isPurchaseRequestTableError(error)) console.error('hub-metrics purchases:', error);
  }

  try {
    metrics.violationsPending = await countViolations(admin, { status: 'pending' });
  } catch (error) {
    if (!isViolationTableError(error)) console.error('hub-metrics violations:', error);
  }

  try {
    metrics.packagesLow = await countLowPackages(admin);
  } catch (error) {
    console.error('hub-metrics packages:', error);
  }

  try {
    metrics.homeworkPendingReview = await countHomeworkPendingReview(admin);
  } catch (error) {
    console.error('hub-metrics homework:', error);
  }

  try {
    metrics.membersNew7d = await countMembersSince7d(admin);
  } catch (error) {
    console.error('hub-metrics members:', error);
  }

  try {
    metrics.homeworkLongPending = await countHomeworkLongPending(admin);
  } catch (error) {
    console.error('hub-metrics homework long:', error);
  }

  try {
    metrics.lessonsToday = await countLessonsToday(admin);
  } catch (error) {
    console.error('hub-metrics lessons today:', error);
  }

  try {
    const st = await countStudentRoleStats(admin);
    metrics.studentsActive = st.active;
    metrics.studentsPaused = st.paused;
    metrics.studentsNew = st.newStudents;
  } catch (error) {
    console.error('hub-metrics students:', error);
  }

  try {
    metrics.scheduleProblems = await countScheduleProblems(admin);
  } catch (error) {
    console.error('hub-metrics schedule problems:', error);
  }

  return metrics;
}

export function attentionTaskCount(metrics: AdminHubMetrics): number {
  let n = 0;
  if (metrics.leadsNew > 0) n += 1;
  if (metrics.purchasesPending > 0) n += 1;
  if (metrics.packagesLow > 0) n += 1;
  if (metrics.homeworkLongPending > 0) n += 1;
  if (metrics.violationsPending > 0) n += 1;
  if (metrics.scheduleProblems > 0) n += 1;
  return n;
}
