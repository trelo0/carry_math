'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

/** Открывает модалку входа при ?login=1 (и сохраняет ?next= для редиректа после OTP). */
export default function AuthQueryTrigger() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { openAuth, phone, loading } = useAuth();
  const opened = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (searchParams.get('login') !== '1') {
      opened.current = false;
      return;
    }

    const next = searchParams.get('next');
    const safeNext =
      next && next.startsWith('/') && !next.startsWith('//') ? next : pathname;

    if (phone) {
      opened.current = false;
      // ?login=1 снимает server redirect после подтверждённой сессии — не трогаем URL на клиенте.
      return;
    }

    if (!opened.current) {
      opened.current = true;
      openAuth(safeNext);
    }
  }, [loading, openAuth, pathname, phone, searchParams]);

  return null;
}
