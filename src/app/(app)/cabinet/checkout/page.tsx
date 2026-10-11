import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetData } from '@/lib/cabinet';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CheckoutContentComponent from '@/components/cabinet/CheckoutContent';
import {
  getCoursePaymentOfferBySlug,
  getDistrictCourseContent,
  listCoursePaymentOffers,
  type CoursePaymentOffer,
} from '@/lib/studio/courseContent';

export const metadata = {
  title: 'Оплата — District',
};

function checkoutReturnTo(courseSlug?: string): string {
  if (courseSlug) return `/cabinet/checkout?product=course&course=${encodeURIComponent(courseSlug)}`;
  return '/cabinet/checkout?product=course';
}

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'занятия';
  return 'занятий';
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; course?: string; package?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const courseSlug = sp.course?.trim() || undefined;
  const returnTo = checkoutReturnTo(courseSlug);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo={returnTo} title="Оплата" />;
    }
    redirect(authLoginRedirectPath(returnTo));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/checkout', sp);
  if (cleanPath) redirect(cleanPath);

  const { product } = sp;
  if (product && product !== 'course') {
    redirect('/cabinet/checkout?product=course');
  }

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo={returnTo} />;
  }

  let offer: CoursePaymentOffer | null = null;
  let purchaseScenarios = null;
  if (courseSlug) {
    offer = await getCoursePaymentOfferBySlug(courseSlug);
    // Загружаем сценарии для District course
    const courseContent = await getDistrictCourseContent(courseSlug);
    purchaseScenarios = courseContent?.purchaseScenarios ?? null;
  } else {
    const offers = cabinet.coursePaymentOffers.length
      ? cabinet.coursePaymentOffers
      : await listCoursePaymentOffers();
    if (offers.length === 1) {
      redirect(`/cabinet/checkout?product=course&course=${encodeURIComponent(offers[0].slug)}`);
    }
    if (offers.length > 1) {
      return (
        <div className="cab-checkout">
          <main className="cab-checkout-card">
            <Link href="/cabinet?section=payments" className="cab-checkout-back">
              ← Вернуться в кабинет
            </Link>
            <span className="cab-checkout-k">Оформление заказа</span>
            <h1>Выберите курс</h1>
            <p className="cab-checkout-desc">Доступны несколько курсов — откройте нужный из списка.</p>
            <ul className="cab-checkout-course-list">
              {offers.map((item) => (
                <li key={item.sanityId}>
                  <Link href={`/cabinet/checkout?product=course&course=${encodeURIComponent(item.slug)}`}>
                    {item.title} · {item.priceByn} BYN · {item.grantedLessons} {pluralLessons(item.grantedLessons)}
                  </Link>
                </li>
              ))}
            </ul>
          </main>
        </div>
      );
    }
  }

  if (!offer) {
    return (
      <div className="cab-checkout">
        <main className="cab-checkout-card">
          <Link href="/cabinet?section=payments" className="cab-checkout-back">
            ← Вернуться в кабинет
          </Link>
          <span className="cab-checkout-k">Оформление заказа</span>
          <h1>Курс недоступен</h1>
          <p className="cab-checkout-desc">
            Для курса не заданы цена и количество занятий в настройках Sanity, либо курс не найден.
          </p>
        </main>
      </div>
    );
  }

  return <CheckoutContentComponent offer={offer} courseSlug={courseSlug || offer.slug} purchaseScenarios={purchaseScenarios} />;
}
