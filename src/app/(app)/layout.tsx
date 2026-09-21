import { Suspense } from 'react';
import { AuthModal } from '@/components';
import AuthQueryTrigger from '@/components/AuthQueryTrigger';

/** Кабинет без маркетинговой шапки, но с модалкой входа. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AuthModal />
      <Suspense fallback={null}>
        <AuthQueryTrigger />
      </Suspense>
    </>
  );
}
