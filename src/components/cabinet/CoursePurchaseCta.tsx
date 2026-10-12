'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import PurchaseScenarioModal from '@/components/cabinet/PurchaseScenarioModal';
import type { CoursePaymentOffer, PurchaseScenarios } from '@/lib/studio/courseContent';

function checkoutHref(courseSlug: string): string {
  return `/cabinet/checkout?product=course&course=${encodeURIComponent(courseSlug)}`;
}

type CoursePurchaseCtaProps = {
  offer: CoursePaymentOffer;
  className?: string;
  children: ReactNode;
};

export default function CoursePurchaseCta({ offer, className, children }: CoursePurchaseCtaProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const scenarios: PurchaseScenarios | null | undefined = offer.purchaseScenarios;

  if (!scenarios) {
    return (
      <a className={className} href={checkoutHref(offer.slug)}>
        {children}
      </a>
    );
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setModalOpen(true)}>
        {children}
      </button>
      {modalOpen && typeof document !== 'undefined'
        ? createPortal(
            <PurchaseScenarioModal
              scenarios={scenarios}
              priceByn={offer.priceByn}
              courseSlug={offer.slug}
              onClose={() => setModalOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  );
}
