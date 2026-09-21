import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetData } from '@/lib/cabinet';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CheckoutPayButton from '@/components/cabinet/CheckoutPayButton';
import { buildPayStartPayload } from '@/lib/bot/studentPurchaseFlow';
import { isAccessProduct, type AccessProduct } from '@/lib/bot/accesses';
export const metadata = {
  title: 'Оплата — District',
};

function payUrl(
  product: AccessProduct,
  packageIndex?: number,
  teacherId?: string,
  teachers?: { teacherId: string }[],
): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) return 'mailto:district.school.210@gmail.com';

  let teacherIndex: number | undefined;
  if (teacherId && teachers?.length) {
    const idx = teachers.findIndex((t) => t.teacherId === teacherId);
    teacherIndex = idx >= 0 ? idx : 0;
  }

  const payload = buildPayStartPayload(product, packageIndex, teacherIndex);
  return `https://t.me/${username}?start=${payload}`;
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; package?: string; teacher?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/checkout" title="Оплата" />;
    }
    redirect(authLoginRedirectPath('/cabinet/checkout'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/checkout', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo="/cabinet/checkout" />;
  }

  const { product, package: packageRaw, teacher: teacherId } = await searchParams;
  if (!product || !isAccessProduct(product)) {
    redirect('/cabinet');
  }

  const pricing = cabinet.cabinetPricing;
  const titles: Record<AccessProduct, string> = {
    course: pricing.course.label,
    individual: pricing.individual.label,
    group: pricing.group.label,
  };
  const descriptions: Record<AccessProduct, string | null> = {
    course: pricing.course.offer.description,
    individual: pricing.individual.offerDescription,
    group: pricing.group.offerDescription,
  };

  const title = titles[product];
  const desc = descriptions[product];

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
        <CheckoutPayButton href={payUrl(product, packageIndex, teacherId, pricing.teachers)} />
        <p className="cab-checkout-note">
          Оформление заявки проходит через Telegram-бот школы. Администратор свяжется с вами для
          подтверждения оплаты.
        </p>
      </main>
    </div>
  );
}
