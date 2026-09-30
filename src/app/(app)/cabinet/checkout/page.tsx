import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetData } from '@/lib/cabinet';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CheckoutPayButton from '@/components/cabinet/CheckoutPayButton';
import { buildPayStartPayload } from '@/lib/bot/studentPurchaseFlow';

export const metadata = {
  title: 'Оплата — District',
};

function payUrl(packageIndex?: number): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) return 'mailto:district.school.210@gmail.com';

  const payload = buildPayStartPayload('course', packageIndex, undefined);
  return `https://t.me/${username}?start=${payload}`;
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; package?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/checkout?product=course" title="Оплата" />;
    }
    redirect(authLoginRedirectPath('/cabinet/checkout?product=course'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/checkout', sp);
  if (cleanPath) redirect(cleanPath);

  const { product, package: packageRaw } = sp;
  if (product && product !== 'course') {
    redirect('/cabinet/checkout?product=course');
  }

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo="/cabinet/checkout?product=course" />;
  }

  const pricing = cabinet.cabinetPricing;
  const title = pricing.course.label;
  const desc = pricing.course.offer.description;

  const packageIndex =
    packageRaw != null && packageRaw !== '' && Number.isFinite(Number(packageRaw))
      ? Math.max(0, Number(packageRaw))
      : undefined;

  return (
    <div className="cab-checkout">
      <main className="cab-checkout-card">
        <Link href="/cabinet" className="cab-checkout-back">
          ← Вернуться в кабинет
        </Link>
        <span className="cab-checkout-k">Оформление заказа</span>
        <h1>{title}</h1>
        {desc && <p className="cab-checkout-desc">{desc}</p>}
        <CheckoutPayButton href={payUrl(packageIndex)} />
        <p className="cab-checkout-note">
          Оформление заявки проходит через Telegram-бот школы. Администратор свяжется с вами для
          подтверждения оплаты.
        </p>
      </main>
    </div>
  );
}
