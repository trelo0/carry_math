import type { SupabaseClient } from '@supabase/supabase-js';

export type ProcessingLockResult = {
  success: boolean;
  reason?: string;
  mode?: string;
  version?: number;
  status?: string;
};

export async function acquireProcessingLock(
  admin: SupabaseClient,
  purchaseRequestId: string,
): Promise<ProcessingLockResult> {
  const { data, error } = await admin.rpc('acquire_processing_lock', {
    p_id: purchaseRequestId,
  });
  if (error) throw error;
  return data as ProcessingLockResult;
}

/** Повторный захват после reset_to_pending в том же webhook. */
export async function acquireProcessingLockWithRetry(
  admin: SupabaseClient,
  purchaseRequestId: string,
  maxAttempts = 2,
): Promise<ProcessingLockResult> {
  let last = await acquireProcessingLock(admin, purchaseRequestId);
  for (let attempt = 1; attempt < maxAttempts && !last.success; attempt += 1) {
    if (last.reason !== 'reset_to_pending') break;
    last = await acquireProcessingLock(admin, purchaseRequestId);
  }
  return last;
}
