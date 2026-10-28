import type { PostgrestError } from '@supabase/supabase-js';

/** Первая строка ответа без maybeSingle (PostgREST PGRST116 при дубликатах). */
export function firstRow<T>(rows: T[] | null | undefined): T | null {
  return rows?.[0] ?? null;
}

export function isPostgrestSingleRowError(error: unknown): boolean {
  const code = (error as PostgrestError | null)?.code;
  return code === 'PGRST116';
}
