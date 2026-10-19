import type { SupabaseClient } from '@supabase/supabase-js';
import { loadClientHubPayload } from './client-nav';

const DISMISS_KEY = 'appealDismissed';

export function isStudentAppealReadsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: unknown })?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('student_appeal_reads') && message.includes('does not exist');
}

async function loadDismissedFromHubPayload(
  admin: SupabaseClient,
  telegramId: number,
): Promise<Set<string>> {
  const loaded = await loadClientHubPayload(admin, telegramId);
  const raw = (loaded?.payload as Record<string, unknown> | undefined)?.[DISMISS_KEY];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x) => typeof x === 'string'));
}

export async function loadDismissedAppealKeys(
  admin: SupabaseClient,
  telegramId: number,
): Promise<Set<string>> {
  try {
    const { data, error } = await admin
      .from('student_appeal_reads')
      .select('appeal_key')
      .eq('student_telegram_id', telegramId)
      .limit(500);
    if (error) throw error;
    const keys = new Set((data ?? []).map((r) => String(r.appeal_key)));
    const legacy = await loadDismissedFromHubPayload(admin, telegramId);
    for (const k of legacy) keys.add(k);
    return keys;
  } catch (error) {
    if (!isStudentAppealReadsTableError(error)) throw error;
    return loadDismissedFromHubPayload(admin, telegramId);
  }
}

export async function markAppealRead(
  admin: SupabaseClient,
  telegramId: number,
  appealKey: string,
): Promise<void> {
  try {
    const { error } = await admin.from('student_appeal_reads').upsert(
      {
        student_telegram_id: telegramId,
        appeal_key: appealKey,
        read_at: new Date().toISOString(),
      },
      { onConflict: 'student_telegram_id,appeal_key' },
    );
    if (error) throw error;
  } catch (error) {
    if (!isStudentAppealReadsTableError(error)) throw error;
    const { getState, saveState, isConversationStateTableError } = await import('./admin/core');
    const { CLIENT_HUB_STEP } = await import('./client-nav');
    const dismissed = await loadDismissedFromHubPayload(admin, telegramId);
    dismissed.add(appealKey);
    try {
      const state = await getState(admin, telegramId);
      const chatId = state?.chat_id ?? telegramId;
      await saveState(
        admin,
        telegramId,
        { chatId, messageId: 0 },
        CLIENT_HUB_STEP,
        {
          ...(state?.payload ?? {}),
          [DISMISS_KEY]: [...dismissed],
        } as never,
      );
    } catch (stateError) {
      if (!isConversationStateTableError(stateError)) throw stateError;
    }
  }
}
