import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { isCuratorCabinetRole, type CuratorAuthContext } from '@/lib/cabinet-auth';
import { isBotRole, type BotRole } from '@/lib/bot/roles';
import { getCuratorCabinetData } from '@/lib/curator/cabinet-data';
import CuratorShell, { type CuratorSection } from '@/components/curator/CuratorShell';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import { isCreatorTelegramId } from '@/lib/bot/roles';

export const metadata = {
  title: 'Кабинет куратора — District',
};

export const dynamic = 'force-dynamic';

const SECTIONS = ['dashboard', 'lessons', 'students', 'homework', 'settings'] as const;

function parseSection(value: string | undefined): CuratorSection | undefined {
  return SECTIONS.includes(value as CuratorSection) ? (value as CuratorSection) : undefined;
}

export default async function CuratorCabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; lesson?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/curator" title="Кабинет куратора" />;
    }
    redirect(authLoginRedirectPath('/cabinet/curator'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/curator', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (authUser.user.user_metadata?.phone as string) ?? authUser.user.phone ?? '';

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    redirect(authLoginRedirectPath('/cabinet/curator'));
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();

  if (!link?.telegram_id) {
    return <CabinetTelegramGate returnTo="/cabinet/curator" />;
  }

  const { data: member } = await admin
    .from('bot_members')
    .select('role, full_name')
    .eq('telegram_id', link.telegram_id)
    .maybeSingle();

  const telegramId = link.telegram_id as number;
  const roleRaw = (member?.role as string | undefined) ?? 'guest';
  if (!isCuratorCabinetRole(roleRaw) && !isCreatorTelegramId(telegramId)) {
    redirect('/cabinet');
  }

  const curatorAuth: CuratorAuthContext = {
    phone,
    telegramId,
    admin,
    role: isBotRole(roleRaw) ? roleRaw : ('guest' as BotRole),
    fullName: (member?.full_name as string | null) ?? null,
  };

  let data;
  try {
    data = await getCuratorCabinetData(
      curatorAuth.admin,
      curatorAuth.telegramId,
      curatorAuth.fullName,
    );
  } catch (error) {
    console.error('[cabinet/curator]', error);
    return (
      <div className="cabinet">
        <div className="cab-main cab-tg-gate-wrap">
          <section className="cab-panel cab-tg-gate">
            <h1>Кабинет куратора временно недоступен</h1>
            <p>Не удалось загрузить данные. Проверьте подключение к Sanity и Supabase.</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <CuratorShell
      data={data}
      initialSection={parseSection(sp.section)}
      initialLessonId={sp.lesson}
      showCabinetPick={isCreatorTelegramId(telegramId)}
    />
  );
}
