import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isCreatorTelegramId, isStaffOnlyMember, loadMemberRoles } from '@/lib/bot/roles';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetData } from '@/lib/cabinet';
import CabinetShell from '@/components/cabinet/CabinetShell';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Кабинет курса — District',
};

export const dynamic = 'force-dynamic';

const SECTIONS = ['course', 'payments', 'settings'] as const;
type CabinetSection = (typeof SECTIONS)[number];

const LEGACY_SECTION_MAP: Record<string, CabinetSection> = {
  lessons: 'course',
  schedule: 'course',
};

function parseSection(value: string | undefined): CabinetSection | undefined {
  if (!value) return undefined;
  if (SECTIONS.includes(value as CabinetSection)) return value as CabinetSection;
  return LEGACY_SECTION_MAP[value];
}

// Личный кабинет ученика: отдельная часть сайта со своим прикладным
// интерфейсом (без маркетинговой шапки и футера).
export default async function CabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; login?: string }>;
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
      const roles = await loadMemberRoles(admin, telegramId);
      if (isStaffOnlyMember(roles) && !isCreatorTelegramId(telegramId)) {
        redirect('/cabinet/staff');
      }
    }
  } catch {
    // service role недоступен — показываем ученический кабинет
  }

  return (
    <CabinetShell
      data={cabinet}
      initialSection={parseSection(sp.section)}
      showCabinetPick={showCabinetPick}
    />
  );
}
