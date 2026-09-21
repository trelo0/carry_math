import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isCuratorCabinetRole } from '@/lib/cabinet-auth';
import { isCreatorTelegramId } from '@/lib/bot/roles';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetData } from '@/lib/cabinet';
import CabinetShell from '@/components/cabinet/CabinetShell';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Личный кабинет — District',
};

export const dynamic = 'force-dynamic';

const SECTIONS = ['course', 'lessons', 'schedule', 'payments', 'settings'] as const;
type CabinetSection = (typeof SECTIONS)[number];
const PRODUCTS = ['course', 'individual', 'group'] as const;
type CabinetProduct = (typeof PRODUCTS)[number];

function parseSection(value: string | undefined): CabinetSection | undefined {
  return SECTIONS.includes(value as CabinetSection) ? (value as CabinetSection) : undefined;
}

function parseProduct(value: string | undefined): CabinetProduct | undefined {
  return PRODUCTS.includes(value as CabinetProduct) ? (value as CabinetProduct) : undefined;
}

// Личный кабинет ученика: отдельная часть сайта со своим прикладным
// интерфейсом (без маркетинговой шапки и футера).
export default async function CabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; product?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet" />;
    }
    redirect(authLoginRedirectPath('/cabinet'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo="/cabinet" />;
  }

  let showCabinetPick = false;
  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from('telegram_links')
      .select('telegram_id')
      .eq('phone', phone)
      .maybeSingle();
    if (link?.telegram_id) {
      const telegramId = link.telegram_id as number;
      showCabinetPick = isCreatorTelegramId(telegramId);
      const { data: member } = await admin
        .from('bot_members')
        .select('role')
        .eq('telegram_id', telegramId)
        .maybeSingle();
      const role = (member?.role as string | undefined) ?? 'guest';
      if (isCuratorCabinetRole(role) && !isCreatorTelegramId(telegramId)) {
        redirect('/cabinet/curator');
      }
    }
  } catch {
    // service role недоступен — показываем ученический кабинет
  }

  return (
    <CabinetShell
      data={cabinet}
      initialSection={parseSection(sp.section)}
      initialProduct={parseProduct(sp.product)}
      showCabinetPick={showCabinetPick}
    />
  );
}
