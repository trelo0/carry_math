import type { SupabaseClient } from '@supabase/supabase-js';
import { clearStateIfAvailable, getState, isConversationStateTableError } from '@/lib/bot/admin/core';
import {
  CURATOR_REJECT_PHOTO_STEP,
  CURATOR_REJECT_TEXT_STEP,
  CURATOR_REJECT_VOICE_STEP,
  STAFF_CURATOR_REPLY_STEP,
  STAFF_TEACHER_HW_REVISION_STEP,
  STAFF_TEACHER_REPLY_STEP,
} from './staff-steps';

const CURATOR_REJECT_STEPS = new Set([
  CURATOR_REJECT_TEXT_STEP,
  CURATOR_REJECT_VOICE_STEP,
  CURATOR_REJECT_PHOTO_STEP,
]);

export async function clearConflictingStaffStates(
  admin: SupabaseClient,
  telegramId: number,
  keep: 'teacher_reply' | 'curator_reply' | 'teacher_hw' | 'curator_reject',
): Promise<void> {
  try {
    const state = await getState(admin, telegramId);
    if (!state?.step) return;
    const step = String(state.step);
    const shouldClear =
      (keep !== 'teacher_reply' && step === STAFF_TEACHER_REPLY_STEP) ||
      (keep !== 'curator_reply' && step === STAFF_CURATOR_REPLY_STEP) ||
      (keep !== 'teacher_hw' && step === STAFF_TEACHER_HW_REVISION_STEP) ||
      (keep !== 'curator_reject' && CURATOR_REJECT_STEPS.has(step));
    if (shouldClear) await clearStateIfAvailable(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}
