import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminAction } from './action-log';

export type ProblemStatus = 'critical' | 'attention' | 'resolved';
export type ProblemCategory = 'finance' | 'schedule' | 'notifications' | 'telegram' | 'education' | 'system';

export type AdminProblemRow = {
  id: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  status: ProblemStatus;
  category: ProblemCategory | string;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  open_callback: string | null;
  source: string;
  detail: Record<string, unknown> | null;
};

const CATEGORY_EMOJI: Record<string, string> = {
  finance: '💳',
  schedule: '📅',
  notifications: '🔔',
  telegram: '📱',
  education: '🎓',
  system: '⚙️',
};

export function problemCategoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? '⚠️';
}

export function isProblemsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: string })?.code ?? '');
  return code === '42P01' || code === 'PGRST205' || message.includes('admin_problems');
}

export async function problemsTableAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('admin_problems').select('id').limit(1);
  if (!error) return true;
  if (isProblemsTableError(error)) return false;
  throw error;
}

export async function countProblemsByStatus(
  admin: SupabaseClient,
  status: ProblemStatus,
): Promise<number> {
  if (!(await problemsTableAvailable(admin))) return 0;
  const { count, error } = await admin
    .from('admin_problems')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  if (error) {
    if (isProblemsTableError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function countProblemsResolvedToday(admin: SupabaseClient): Promise<number> {
  if (!(await problemsTableAvailable(admin))) return 0;
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const mskMidnight = Math.floor((Date.now() + mskOffset) / msDay) * msDay - mskOffset;
  const fromIso = new Date(mskMidnight).toISOString();
  const { count, error } = await admin
    .from('admin_problems')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'resolved')
    .gte('resolved_at', fromIso);
  if (error) {
    if (isProblemsTableError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function listProblems(
  admin: SupabaseClient,
  filter: ProblemStatus | 'all',
  page: number,
  perPage = 6,
): Promise<{ rows: AdminProblemRow[]; total: number }> {
  if (!(await problemsTableAvailable(admin))) return { rows: [], total: 0 };

  const from = page * perPage;
  let builder = admin
    .from('admin_problems')
    .select(
      'id, created_at, updated_at, resolved_at, status, category, title, description, entity_type, entity_id, open_callback, source, detail',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (filter !== 'all') builder = builder.eq('status', filter);

  const { data, error, count } = await builder.range(from, from + perPage - 1);
  if (error) {
    if (isProblemsTableError(error)) return { rows: [], total: 0 };
    throw error;
  }
  return { rows: (data ?? []) as AdminProblemRow[], total: count ?? 0 };
}

export async function getProblem(admin: SupabaseClient, id: number): Promise<AdminProblemRow | null> {
  const { data, error } = await admin.from('admin_problems').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isProblemsTableError(error)) return null;
    throw error;
  }
  return (data as AdminProblemRow | null) ?? null;
}

export type CreateProblemInput = {
  status?: ProblemStatus;
  category: ProblemCategory | string;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string | number;
  openCallback?: string;
  source?: string;
  detail?: Record<string, unknown>;
  dedupeKey?: string;
};

export async function createAdminProblem(
  admin: SupabaseClient,
  input: CreateProblemInput,
): Promise<number | null> {
  if (!(await problemsTableAvailable(admin))) return null;

  if (input.dedupeKey) {
    const { data: existing } = await admin
      .from('admin_problems')
      .select('id')
      .contains('detail', { dedupeKey: input.dedupeKey })
      .in('status', ['critical', 'attention'])
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id as number;
  }

  const detail = { ...(input.detail ?? {}), ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}) };
  const { data, error } = await admin
    .from('admin_problems')
    .insert({
      status: input.status ?? 'attention',
      category: input.category,
      title: input.title,
      description: input.description ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId != null ? String(input.entityId) : null,
      open_callback: input.openCallback ?? null,
      source: input.source ?? 'system',
      detail: Object.keys(detail).length > 0 ? detail : null,
    })
    .select('id')
    .single();
  if (error) {
    if (isProblemsTableError(error)) return null;
    throw error;
  }
  const newId = (data as { id: number } | null)?.id ?? null;
  if (newId) {
    await logAdminAction(admin, {
      actorTelegramId: 0,
      action: 'problem.create',
      entityType: 'problem',
      entityId: newId,
      detail: { category: input.category, title: input.title },
    });
  }
  return newId;
}

export async function resolveOpenProblemsByDedupeKey(
  admin: SupabaseClient,
  dedupeKey: string,
  actorTelegramId: number,
): Promise<number> {
  if (!(await problemsTableAvailable(admin))) return 0;
  const { data, error } = await admin
    .from('admin_problems')
    .select('id')
    .contains('detail', { dedupeKey })
    .in('status', ['critical', 'attention']);
  if (error) {
    if (isProblemsTableError(error)) return 0;
    throw error;
  }
  let n = 0;
  for (const row of data ?? []) {
    if (await resolveAdminProblem(admin, row.id as number, actorTelegramId)) n += 1;
  }
  return n;
}

export async function resolveAdminProblem(
  admin: SupabaseClient,
  id: number,
  actorTelegramId: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('admin_problems')
    .update({ status: 'resolved', resolved_at: now, updated_at: now })
    .eq('id', id)
    .in('status', ['critical', 'attention'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  await logAdminAction(admin, {
    actorTelegramId,
    action: 'problem.resolve',
    entityType: 'problem',
    entityId: id,
  });
  return true;
}
