import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type CabinetAuthContext = {
  phone: string;
  telegramId: number;
  admin: ReturnType<typeof createAdminClient>;
};

/** Авторизация кабинета: phone → telegram_id. */
export async function getCabinetAuth(): Promise<CabinetAuthContext | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  if (!phone) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) return null;

  return { phone, telegramId: link.telegram_id as number, admin };
}
