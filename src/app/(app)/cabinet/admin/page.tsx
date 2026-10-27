import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { loadMemberRoles, memberHasRole } from '@/lib/bot/roles';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Панель управления — District',
};

export const dynamic = 'force-dynamic';

export default async function CabinetAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: authUser } = await supabase.auth.getUser();

  if (!authUser.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/admin" title="Панель управления" />;
    }
    redirect(authLoginRedirectPath('/cabinet/admin'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/admin', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (authUser.user.user_metadata?.phone as string) ?? authUser.user.phone ?? '';

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect('/cabinet');
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();

  if (!link?.telegram_id) {
    return <CabinetTelegramGate returnTo="/cabinet/admin" />;
  }

  const roles = await loadMemberRoles(admin, link.telegram_id as number);
  if (!memberHasRole(roles, 'admin')) {
    redirect('/cabinet');
  }

  return (
    <div className="cabinet">
      <div className="cab-main cab-tg-gate-wrap">
        <section className="cab-panel cab-tg-gate">
          <h1>Панель управления для админа</h1>
        </section>
      </div>
    </div>
  );
}
