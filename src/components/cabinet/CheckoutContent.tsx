'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PurchaseScenarioModal from './PurchaseScenarioModal';
import CheckoutPayButton from './CheckoutPayButton';
import type { CoursePaymentOffer, PurchaseScenarios } from '@/lib/studio/courseContent';

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
  purchaseScenarios: PurchaseScenarios | null;
}

export default function CheckoutContent({ offer, courseSlug, purchaseScenarios }: CheckoutContentProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(true);
  const payMode = purchaseScenarios ? 'first' : 'direct';

  const handlePayClick = () => {
    setShowModal(true);
  };

  if (showModal) {
    return (
      <PurchaseScenarioModal
        scenarios={purchaseScenarios}
        mode={payMode}
        priceByn={offer.priceByn}
        courseSlug={courseSlug}
        grantedLessons={offer.grantedLessons}
        onClose={() => {
          setShowModal(false);
          router.push('/cabinet?section=payments');
        }}
      />
    );
  }

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
          Оплата проходит на защищённой странице bePaid. После успешного платежа пакет занятий
          появится в кабинете автоматически.
        </p>
      </main>
    </div>
  );
}
