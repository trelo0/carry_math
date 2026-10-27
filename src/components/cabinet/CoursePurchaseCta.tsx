'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import PurchaseScenarioModal from '@/components/cabinet/PurchaseScenarioModal';
import CoursePackageRenewConfirm from '@/components/cabinet/CoursePackageRenewConfirm';
import type { CoursePaymentOffer } from '@/lib/studio/courseContent';
import { hasPurchaseScenarioCards, type PurchaseScenario } from '@/lib/course-purchase-scenario';

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
  const scenarios = offer.purchaseScenarios ?? null;
  const isFirstPurchase = !savedPurchaseScenario;
  const payMode = isFirstPurchase
    ? hasPurchaseScenarioCards(scenarios)
      ? 'first'
      : 'direct'
    : 'extend';
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

  const modal =
    purchaseModalOpen && typeof document !== 'undefined' ? (
      <PurchaseScenarioModal
        scenarios={payMode === 'first' ? scenarios : null}
        mode={payMode}
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
