'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';

/** Убирает ?login=1 после успешного входа (раньше делал AdminPageFrame). */
export default function AdminStripLoginQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params: Record<string, string | undefined> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const clean = pathWithoutAuthLoginQuery(pathname, params);
    if (clean) router.replace(clean);
  }, [pathname, router, searchParams]);

  return null;
}
