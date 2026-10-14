'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import PurchaseScenarioModal from '@/components/cabinet/PurchaseScenarioModal';
import CoursePackageRenewConfirm from '@/components/cabinet/CoursePackageRenewConfirm';
import type { CoursePaymentOffer, PurchaseScenarios } from '@/lib/studio/courseContent';
import type { PurchaseScenario } from '@/lib/course-purchase-scenario';

function checkoutHref(courseSlug: string): string {
  return `/cabinet/checkout?product=course&course=${encodeURIComponent(courseSlug)}`;
}

type CoursePurchaseCtaProps = {
  offer: CoursePaymentOffer;
  className?: string;
  children: ReactNode;
  /** Сохранённый сценарий (null — первая покупка, показываем выбор). */
  savedPurchaseScenario?: PurchaseScenario | null;
  savedScenarioLabel?: string | null;
  packageRemaining?: number;
  packageTotal?: number;
};

export default function CoursePurchaseCta({
  offer,
  className,
  children,
  savedPurchaseScenario = null,
  savedScenarioLabel = null,
  packageRemaining = 0,
  packageTotal = 0,
}: CoursePurchaseCtaProps) {
  const [renewConfirmOpen, setRenewConfirmOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const scenarios: PurchaseScenarios | null | undefined = offer.purchaseScenarios;
  const isFirstPurchase = !savedPurchaseScenario;
  const hasActivePackage = packageRemaining > 0;

  const openPurchaseFlow = () => {
    if (hasActivePackage) {
      setRenewConfirmOpen(true);
      return;
    }
    setPurchaseModalOpen(true);
  };

  const afterRenewConfirm = () => {
    setRenewConfirmOpen(false);
    setPurchaseModalOpen(true);
  };

  if (!scenarios && isFirstPurchase) {
    return (
      <a className={className} href={checkoutHref(offer.slug)}>
        {children}
      </a>
    );
  }

  const modal =
    purchaseModalOpen && typeof document !== 'undefined' ? (
      <PurchaseScenarioModal
        scenarios={isFirstPurchase ? scenarios ?? null : null}
        mode={isFirstPurchase ? 'first' : 'extend'}
        priceByn={offer.priceByn}
        courseSlug={offer.slug}
        grantedLessons={offer.grantedLessons}
        savedScenarioLabel={savedScenarioLabel}
        onClose={() => setPurchaseModalOpen(false)}
      />
    ) : null;

  return (
    <>
      <button type="button" className={className} onClick={openPurchaseFlow}>
        {children}
      </button>
      {renewConfirmOpen && typeof document !== 'undefined'
        ? createPortal(
            <CoursePackageRenewConfirm
              remaining={packageRemaining}
              total={packageTotal}
              grantLessons={offer.grantedLessons}
              onConfirm={afterRenewConfirm}
              onClose={() => setRenewConfirmOpen(false)}
            />,
            document.body,
          )
        : null}
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}
