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
  membersNew7d: number;
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
    membersNew7d: 0,
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

  return metrics;
}

export function attentionTaskCount(metrics: AdminHubMetrics): number {
  return (
    metrics.leadsNew +
    metrics.purchasesPending +
    metrics.violationsPending +
    metrics.packagesLow +
    (metrics.homeworkPendingReview > 0 ? 1 : 0)
  );
}
