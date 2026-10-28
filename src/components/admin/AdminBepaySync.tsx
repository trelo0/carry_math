'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type ShopSummary = { shop: string; fetched: number; saved: number; errors: string[] };
type Summary = { days: number; shops: ShopSummary[]; productsShopConfigured: boolean };

function periodToSyncDays(period: string | null): number {
  switch (period) {
    case 'today':
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case 'month':
      return 31;
    case 'all':
      return 90;
    default:
      return 7;
  }
}

export default function AdminBepaySync() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const showToast = (next: { type: 'ok' | 'error'; text: string }) => {
    setToast(next);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setToast(null), 4500);
  };

  const run = async () => {
    const days = periodToSyncDays(params.get('period'));
    setBusy(true);
    try {
      const res = await fetch('/api/admin/finance/journal/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const body = (await res.json()) as { error?: string; summary?: Summary };
      if (!res.ok || !body.summary) throw new Error(body.error ?? 'Не удалось обновить данные');
      const errors = body.summary.shops.flatMap((s) => s.errors.map((e) => `${s.shop}: ${e}`));
      const saved = body.summary.shops.reduce((n, s) => n + s.saved, 0);
      if (errors.length > 0) {
        showToast({ type: 'error', text: `Часть данных не загружена: ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''}` });
      } else {
        showToast({
          type: 'ok',
          text: saved > 0 ? `Журнал обновлён: ${saved} транзакций` : 'Новых транзакций не найдено',
        });
      }
      router.refresh();
    } catch (error) {
      showToast({ type: 'error', text: error instanceof Error ? error.message : 'Ошибка' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-fin__sync">
      <button type="button" className="admin-fin__refresh" disabled={busy} onClick={() => void run()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className={busy ? 'is-spinning' : undefined}>
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {busy ? 'Обновление…' : 'Обновить'}
      </button>
      {toast ? (
        <div className={`admin-fin__toast admin-fin__toast--${toast.type}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
