'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import { authLoginRedirectPath } from '@/lib/auth-login-redirect';
import { adminNavForPathname } from '@/lib/admin/nav-path';

type Props = {
  /** false = телеграм не привязан */
  telegramLinked: boolean;
};

export default function AdminUnauthHandler({ telegramLinked }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = adminNavForPathname(pathname).href;

  const loginModal = searchParams.get('login') === '1';

  useEffect(() => {
    if (loginModal || !telegramLinked) return;
    router.replace(authLoginRedirectPath(returnTo));
  }, [loginModal, returnTo, router, telegramLinked]);

  if (loginModal) {
    return <CabinetLoginGate returnTo={returnTo} title="Панель управления" />;
  }
  if (!telegramLinked) {
    return <CabinetTelegramGate returnTo={returnTo} />;
  }

  return <div className="admin-panel__loading">Перенаправление…</div>;
}
