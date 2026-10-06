import type { SupabaseClient } from '@supabase/supabase-js';
import { clearStateIfAvailable, getState, isConversationStateTableError } from './admin/core';

/** Сброс активного wizard при /start и /menu, чтобы не смешивать роли и сценарии. */
export async function clearBotWizardStateOnMenuStart(
  admin: SupabaseClient,
  telegramId: number,
): Promise<void> {
  try {
    const state = await getState(admin, telegramId);
    if (!state?.step) return;
    await clearStateIfAvailable(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}
