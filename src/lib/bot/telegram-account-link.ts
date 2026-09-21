import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/phone';

/** Создаёт или находит Supabase Auth user по телефону (синтетический email). */
export async function ensureAuthUserForPhone(
  admin: SupabaseClient,
  phone: string,
): Promise<string> {
  const syntheticEmail = `u${phone.replace(/\D/g, '')}@auth.district.school`;
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1 });
  if (listError) throw listError;

  const existing = (listed.users ?? []).find((u) => u.email === syntheticEmail);
  if (existing?.id) return existing.id;

  const tempPassword = randomBytes(32).toString('base64url');
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { phone },
  });
  if (createError || !created.user) throw createError ?? new Error('user not created');
  return created.user.id;
}

export type LinkTelegramResult =
  | { ok: true; phone: string; created: boolean }
  | { ok: false; error: string };

/** Привязывает telegram_id к телефону и создаёт auth-аккаунт при необходимости. */
export async function linkTelegramToPhone(
  admin: SupabaseClient,
  telegramId: number,
  rawPhone: string,
  options?: { fullName?: string },
): Promise<LinkTelegramResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: 'Не удалось распознать номер. Отправьте контакт или номер в формате +375…' };
  }

  const { data: byPhone, error: phoneError } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (phoneError) throw phoneError;
  if (byPhone?.telegram_id && byPhone.telegram_id !== telegramId) {
    return { ok: false, error: 'Этот номер уже привязан к другому Telegram-аккаунту.' };
  }

  const { data: byTelegram, error: tgError } = await admin
    .from('telegram_links')
    .select('phone')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (tgError) throw tgError;
  if (byTelegram?.phone && byTelegram.phone !== phone) {
    return {
      ok: false,
      error: 'Ваш Telegram уже привязан к другому номеру. Напишите в поддержку, если нужна помощь.',
    };
  }

  const userId = await ensureAuthUserForPhone(admin, phone);
  const created = !byPhone?.telegram_id;

  const { error: linkError } = await admin.from('telegram_links').upsert(
    {
      phone,
      telegram_id: telegramId,
      user_id: userId,
      linked_at: new Date().toISOString(),
    },
    { onConflict: 'phone' },
  );
  if (linkError) throw linkError;

  const memberPatch: Record<string, string> = { phone, updated_at: new Date().toISOString() };
  if (options?.fullName?.trim()) memberPatch.full_name = options.fullName.trim();
  await admin.from('bot_members').update(memberPatch).eq('telegram_id', telegramId);

  return { ok: true, phone, created };
}
