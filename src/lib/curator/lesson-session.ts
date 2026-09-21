import type { SupabaseClient } from '@supabase/supabase-js';

export type SanityWebinarSessionStatus =
  | 'scheduled'
  | 'waiting'
  | 'live'
  | 'completed'
  | 'cancelled';

export type SanityLessonSessionRow = {
  sanity_lesson_id: string;
  status: SanityWebinarSessionStatus;
  started_at: string | null;
  ended_at: string | null;
  started_by: number | null;
  ended_by: number | null;
  updated_at: string;
};

export function isSanitySessionTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('sanity_lesson_sessions') || message.includes('Could not find');
}

/** Статус по умолчанию, если куратор ещё не трогал занятие. */
export function defaultWebinarSessionStatus(scheduledAt: string | null): SanityWebinarSessionStatus {
  if (!scheduledAt) return 'scheduled';
  const start = Date.parse(scheduledAt);
  if (Number.isNaN(start)) return 'scheduled';
  return start > Date.now() ? 'scheduled' : 'waiting';
}

export function resolveWebinarSessionStatus(
  scheduledAt: string | null,
  row: Pick<SanityLessonSessionRow, 'status'> | null | undefined,
): SanityWebinarSessionStatus {
  if (row?.status) return row.status;
  return defaultWebinarSessionStatus(scheduledAt);
}

export async function loadSanityLessonSessionMap(
  admin: SupabaseClient,
  sanityLessonIds: string[],
): Promise<Map<string, SanityLessonSessionRow>> {
  const map = new Map<string, SanityLessonSessionRow>();
  if (sanityLessonIds.length === 0) return map;

  const { data, error } = await admin
    .from('sanity_lesson_sessions')
    .select('sanity_lesson_id, status, started_at, ended_at, started_by, ended_by, updated_at')
    .in('sanity_lesson_id', sanityLessonIds);
  if (error) {
    if (isSanitySessionTableError(error)) return map;
    throw error;
  }

  for (const row of data ?? []) {
    map.set(row.sanity_lesson_id as string, row as SanityLessonSessionRow);
  }
  return map;
}

export async function getSanityLessonSession(
  admin: SupabaseClient,
  sanityLessonId: string,
): Promise<SanityLessonSessionRow | null> {
  const { data, error } = await admin
    .from('sanity_lesson_sessions')
    .select('sanity_lesson_id, status, started_at, ended_at, started_by, ended_by, updated_at')
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) {
    if (isSanitySessionTableError(error)) return null;
    throw error;
  }
  return (data as SanityLessonSessionRow | null) ?? null;
}

async function upsertSession(
  admin: SupabaseClient,
  sanityLessonId: string,
  patch: Partial<SanityLessonSessionRow> & { status: SanityWebinarSessionStatus },
): Promise<SanityLessonSessionRow> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('sanity_lesson_sessions')
    .upsert(
      {
        sanity_lesson_id: sanityLessonId,
        status: patch.status,
        started_at: patch.started_at ?? null,
        ended_at: patch.ended_at ?? null,
        started_by: patch.started_by ?? null,
        ended_by: patch.ended_by ?? null,
        updated_at: now,
      },
      { onConflict: 'sanity_lesson_id' },
    )
    .select('sanity_lesson_id, status, started_at, ended_at, started_by, ended_by, updated_at')
    .single();
  if (error) throw error;
  return data as SanityLessonSessionRow;
}

export async function startSanityLessonSession(
  admin: SupabaseClient,
  sanityLessonId: string,
  curatorTelegramId: number,
): Promise<SanityLessonSessionRow> {
  const now = new Date().toISOString();
  return upsertSession(admin, sanityLessonId, {
    status: 'live',
    started_at: now,
    ended_at: null,
    started_by: curatorTelegramId,
    ended_by: null,
  });
}

export async function endSanityLessonSession(
  admin: SupabaseClient,
  sanityLessonId: string,
  curatorTelegramId: number,
): Promise<SanityLessonSessionRow> {
  const existing = await getSanityLessonSession(admin, sanityLessonId);
  const now = new Date().toISOString();
  return upsertSession(admin, sanityLessonId, {
    status: 'completed',
    started_at: existing?.started_at ?? now,
    ended_at: now,
    started_by: existing?.started_by ?? curatorTelegramId,
    ended_by: curatorTelegramId,
  });
}

export async function syncSessionAfterScheduleSave(
  admin: SupabaseClient,
  sanityLessonId: string,
  scheduledAt: string | null,
): Promise<void> {
  try {
    const row = await getSanityLessonSession(admin, sanityLessonId);
    if (row && (row.status === 'live' || row.status === 'completed' || row.status === 'cancelled')) {
      return;
    }
    const next = defaultWebinarSessionStatus(scheduledAt);
    if (row?.status === next) return;
    await upsertSession(admin, sanityLessonId, {
      status: next,
      started_at: null,
      ended_at: null,
      started_by: null,
      ended_by: null,
    });
  } catch (error) {
    if (isSanitySessionTableError(error)) return;
    throw error;
  }
}
