import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { isCreatorTelegramId } from '@/lib/bot/roles';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Выбор кабинета — District',
};

export const dynamic = 'force-dynamic';

export default async function CabinetPickPage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: authUser } = await supabase.auth.getUser();

  if (!authUser.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/pick" title="Выбор кабинета" />;
    }
    redirect(authLoginRedirectPath('/cabinet/pick'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/pick', sp);
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
    return <CabinetTelegramGate returnTo="/cabinet/pick" />;
  }

  const telegramId = link.telegram_id as number;
  if (!isCreatorTelegramId(telegramId)) {
    redirect('/cabinet');
  }

  return (
    <div className="cabinet">
      <div className="cab-main cab-tg-gate-wrap">
        <section className="cab-panel cab-tg-gate cab-pick">
          <h1>Какой кабинет открыть?</h1>
          <p>Режим разработчика: смотри интерфейсы так же, как пользователи с разными ролями.</p>
          <div className="cab-pick-grid">
            <Link href="/cabinet" className="cab-btn cab-btn--join cab-pick-card">
              <strong>Ученик</strong>
              <span>Курс, занятия, оплата</span>
            </Link>
            <Link href="/cabinet/curator" className="cab-btn cab-btn--join cab-pick-card">
              <strong>Куратор</strong>
              <span>Уроки, ученики, домашки</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
