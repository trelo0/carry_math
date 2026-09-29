'use client';

import dynamic from 'next/dynamic';

const ModalPopup = dynamic(() => import('./ModalPopup'), { ssr: false });
const WebinarEntryPopup = dynamic(() => import('./WebinarEntryPopup'), { ssr: false });
const AuthModal = dynamic(() => import('./AuthModal'), { ssr: false });

export default function SiteOverlays({
  modalTitle,
  modalSubmitButtonText,
}: {
  modalTitle?: string;
  modalSubmitButtonText?: string;
}) {
  return (
    <>
      <ModalPopup modalTitle={modalTitle} modalSubmitButtonText={modalSubmitButtonText} />
      <WebinarEntryPopup />
      <AuthModal />
    </>
  );
}
