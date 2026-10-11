'use client';

import { useState } from 'react';
import Link from 'next/link';
import PurchaseScenarioModal from './PurchaseScenarioModal';
import CheckoutPayButton from './CheckoutPayButton';
import type { CoursePaymentOffer } from '@/lib/studio/courseContent';

function payUrl(courseSlug: string, scenario?: 'start_from_beginning' | 'join_current'): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) return 'mailto:district.school.210@gmail.com';
  const slug = scenario ? `${courseSlug}:${scenario}` : courseSlug;
  return `https://t.me/${username}?start=pay_course_s_${slug}`;
}

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'занятия';
  return 'занятий';
}

interface CheckoutContentProps {
  offer: CoursePaymentOffer;
  courseSlug: string;
  purchaseScenarios: { startFromBeginning: any; joinCurrent: any } | null;
}

export default function CheckoutContent({ offer, courseSlug, purchaseScenarios }: CheckoutContentProps) {
  const [showModal, setShowModal] = useState(false);

  const handlePayClick = () => {
    if (purchaseScenarios) {
      setShowModal(true);
    } else {
      // Fallback: direct pay if no scenarios configured
      window.location.href = payUrl(courseSlug);
    }
  };

  return (
    <div className="cab-checkout">
      <main className="cab-checkout-card">
        <Link href="/cabinet?section=payments" className="cab-checkout-back">
          ← Вернуться в кабинет
        </Link>
        <span className="cab-checkout-k">Оформление заказа</span>
        <h1>{offer.title}</h1>
        {offer.cardText && <p className="cab-checkout-desc">{offer.cardText}</p>}
        {!offer.cardText && offer.description && <p className="cab-checkout-desc">{offer.description}</p>}
        <p className="cab-checkout-price">
          <strong>{offer.priceByn} BYN</strong>
          <span>
            {offer.grantedLessons} {pluralLessons(offer.grantedLessons)} после оплаты
          </span>
        </p>
        <CheckoutPayButton href="#" onClick={handlePayClick} />
        <p className="cab-checkout-note">
          Оформление заявки проходит через Telegram-бот школы. Администратор свяжется с вами для
          подтверждения оплаты.
        </p>
        {showModal && purchaseScenarios && (
          <PurchaseScenarioModal
            scenarios={purchaseScenarios}
            priceByn={offer.priceByn}
            courseSlug={courseSlug}
            onClose={() => setShowModal(false)}
          />
        )}
      </main>
    </div>
  );
}
