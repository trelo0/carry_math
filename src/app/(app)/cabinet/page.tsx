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

function parsePaymentResult(value: string | undefined): 'success' | 'failed' | undefined {
  if (value === 'success' || value === 'failed') return value;
  return undefined;
}

function cabinetReturnPath(sp: {
  section?: string;
  payment?: string;
  course?: string;
}): string {
  const params = new URLSearchParams();
  const section = parseSection(sp.section);
  if (section) params.set('section', section);
  const payment = parsePaymentResult(sp.payment);
  if (payment) params.set('payment', payment);
  if (sp.course?.trim()) params.set('course', sp.course.trim());
  const qs = params.toString();
  return qs ? `/cabinet?${qs}` : '/cabinet';
}

// Личный кабинет ученика: отдельная часть сайта со своим прикладным
// интерфейсом (без маркетинговой шапки и футера).
export default async function CabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; login?: string; payment?: string; course?: string }>;
}) {
  const sp = await searchParams;
  const returnTo = cabinetReturnPath(sp);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo={returnTo} />;
    }
    redirect(authLoginRedirectPath(returnTo));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at, sp.course);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo={returnTo} />;
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
      initialPaymentResult={parsePaymentResult(sp.payment)}
      showCabinetPick={showCabinetPick}
    />
  );
}
