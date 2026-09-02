import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CheckoutPayButton from '@/components/cabinet/CheckoutPayButton';

export const metadata = {
  title: 'Оплата — District',
};

/* Демо-каталог продуктов: реальных платежей в проекте ещё нет.
   Описания временные — заменить при подключении платёжной
   интеграции (кнопка записи станет вести на реальный checkout). */
const PRODUCTS: Record<
  string,
  { title: string; desc: string }
> = {
  course: {
    title: 'Курс подготовки',
    desc: '74 занятия в 7 модулях: от стартовой диагностики до пробного экзамена. Доступ к записям, домашкам и куратору на 12 месяцев.',
  },
  individual: {
    title: 'Индивидуальные занятия',
    desc: 'Занятия 1-на-1 с преподавателем под твою цель и график. 60 минут, запись и конспект остаются у тебя.',
  },
  group: {
    title: 'Групповые занятия',
    desc: 'Мини-группы: живое общение, разбор задач и мотивация. Преподаватель, материалы и домашки с проверкой.',
  },
};

/* Пока платёжной страницы нет, оплата оформляется через Telegram-бота
   школы (start-пейлоад pay_<продукт>) — бот может сразу начать сценарий
   покупки. Заменить на URL реального checkout при подключении платежей. */
function payUrl(product: string): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return username
    ? `https://t.me/${username}?start=pay_${product}`
    : 'mailto:district.school.210@gmail.com';
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login');
  }

  const { product } = await searchParams;
  const item = product ? PRODUCTS[product] : undefined;

  if (!product || !item) {
    redirect('/cabinet');
  }

  return (
    <div className="cab-checkout">
      <main className="cab-checkout-card">
        <Link href="/cabinet" className="cab-checkout-back">
          ← Вернуться в кабинет
        </Link>
        <span className="cab-checkout-k">Оформление заказа</span>
        <h1>{item.title}</h1>
        <p className="cab-checkout-desc">{item.desc}</p>
        <CheckoutPayButton href={payUrl(product)} />
        <p className="cab-checkout-note">
          Оплата проходит через Telegram-бот школы. После оплаты доступ
          появится в кабинете автоматически.
        </p>
      </main>
    </div>
  );
}
