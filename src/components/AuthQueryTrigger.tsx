'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { clearAuthHash, getAuthHash } from '@/lib/auth-hash';

/** Открывает модалку входа при #login, #register, ?login=1 или ?register=1. */
export default function AuthQueryTrigger() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { openAuth, phone, loading, authOpen } = useAuth();
  const opened = useRef(false);

  const queryOpen =
    searchParams.get('login') === '1' || searchParams.get('register') === '1';

  useEffect(() => {
    if (loading) return;

    const tryOpen = () => {
      const authHash = getAuthHash();
      const shouldOpen = queryOpen || authHash !== null;

      if (!shouldOpen) {
        opened.current = false;
        return;
      }

      const next = searchParams.get('next');
      const safeNext =
        next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : authHash
            ? '/cabinet'
            : pathname;

      if (phone) {
        opened.current = false;
        if (authHash) clearAuthHash();
        return;
      }

      if (!opened.current) {
        opened.current = true;
        openAuth(safeNext);
      }
    };

    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  }, [loading, openAuth, pathname, phone, queryOpen, searchParams]);

  useEffect(() => {
    if (loading || authOpen) return;
    if (!getAuthHash()) return;
    opened.current = false;
    clearAuthHash();
  }, [authOpen, loading]);

  return null;
}
