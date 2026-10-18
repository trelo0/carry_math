import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function syntheticEmailForPhone(phone: string): string {
  return `u${phone.replace(/\D/g, '')}@auth.district.school`;
}

function isDuplicateAuthUserError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error).toLowerCase();
  return msg.includes('already') || msg.includes('registered') || msg.includes('exists');
}

/** Поиск по email — только если createUser вернул «уже есть» (без listUsers page 1). */
async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  let page = 1;
  const perPage = 500;
  for (let guard = 0; guard < 30; guard += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit?.id) return hit.id;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

/** Создаёт или находит Supabase Auth user по телефону (синтетический email). */
export async function ensureAuthUserForPhone(
  admin: SupabaseClient,
  phone: string,
): Promise<string> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('phone', phone)
    .maybeSingle();
  if (link?.user_id) return link.user_id as string;

  const syntheticEmail = syntheticEmailForPhone(phone);
  const tempPassword = randomBytes(32).toString('base64url');
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { phone },
  });
  if (!createError && created?.user?.id) return created.user.id;

  if (createError && isDuplicateAuthUserError(createError)) {
    const existingId = await findAuthUserIdByEmail(admin, syntheticEmail);
    if (existingId) return existingId;
  }

  throw createError ?? new Error('auth user not found');
}

/** Одноразовый пароль для signInWithPassword после OTP или magic-link. */
export async function preparePhoneAuthSignIn(
  admin: SupabaseClient,
  phone: string,
): Promise<{ userId: string; syntheticEmail: string; tempPassword: string }> {
  const userId = await ensureAuthUserForPhone(admin, phone);
  const syntheticEmail = syntheticEmailForPhone(phone);
  const tempPassword = randomBytes(32).toString('base64url');
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (updateError) throw updateError;
  return { userId, syntheticEmail, tempPassword };
}
