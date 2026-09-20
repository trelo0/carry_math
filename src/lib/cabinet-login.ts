import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBaseUrlString } from '@/lib/siteUrl';

const TOKEN_TTL_MS = 15 * 60_000;

function isCabinetLoginTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('cabinet_login_tokens');
}

export async function createCabinetLoginUrl(
  admin: SupabaseClient,
  telegramId: number,
  path = '/cabinet',
): Promise<string> {
  const base = getBaseUrlString();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  try {
    await admin.from('cabinet_login_tokens').insert({
      token,
      telegram_id: telegramId,
      expires_at: expiresAt,
    });
    const safePath = path.startsWith('/') ? path : `/${path}`;
    return `${base}/auth/cabinet?token=${encodeURIComponent(token)}&next=${encodeURIComponent(safePath)}`;
  } catch (error) {
    if (!isCabinetLoginTableError(error)) throw error;
    const safePath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${safePath}`;
  }
}

export async function resolveCabinetLoginToken(
  admin: SupabaseClient,
  token: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('cabinet_login_tokens')
    .select('telegram_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();
  if (error) {
    if (isCabinetLoginTableError(error)) return null;
    throw error;
  }
  if (!data || data.used_at) return null;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return null;

  await admin
    .from('cabinet_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null);

  return data.telegram_id as number;
}
