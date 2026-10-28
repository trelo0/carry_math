'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import AdminBepaySync from '@/components/admin/AdminBepaySync';

const PERIODS = [
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: '90d', label: 'Последние 90 дней' },
  { value: 'month', label: 'Текущий месяц' },
  { value: 'all', label: 'Всё время' },
];

const SOURCES = [
  { value: '', label: 'Все платежи' },
  { value: 'site', label: 'Оплаты курсов' },
  { value: 'product', label: 'Оплата занятий' },
];

const STATUSES = [
  { value: '', label: 'Все статусы' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'refunded', label: 'Возврат' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'failed', label: 'Не прошёл' },
  { value: 'cancelled', label: 'Отменён / истёк' },
];

function useParamPush() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const push = (next: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete('page');
    sp.delete('method');
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  return { params, push };
}

function FinanceSelect({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon?: ReactNode;
}) {
  return (
    <label className="admin-fin__select-wrap">
      {icon ? <span className="admin-fin__select-icon">{icon}</span> : null}
      <select className="admin-fin__select-native" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value || '__all'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="admin-fin__select-chevron" aria-hidden>
        ▾
      </span>
    </label>
  );
}

export function AdminFinanceFilters() {
  const { params, push } = useParamPush();
  return (
    <div className="admin-fin__filters">
      <FinanceSelect
        label="Период"
        value={params.get('period') ?? '30d'}
        options={PERIODS}
        onChange={(v) => push({ period: v === '30d' ? '' : v })}
        icon={
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        }
      />
      <FinanceSelect
        label="Источник"
        value={params.get('source') ?? ''}
        options={SOURCES}
        onChange={(v) => push({ source: v })}
      />
      <AdminBepaySync />
    </div>
  );
}

export function AdminFinanceTableControls() {
  const { params, push } = useParamPush();
  const [q, setQ] = useState(params.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="admin-fin__table-controls">
      <label className="admin-courses__search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder="Поиск по ученику, продукту, ID…"
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => push({ q: v.trim().length >= 2 ? v.trim() : '' }), 350);
          }}
        />
      </label>
      <FinanceSelect
        label="Статус"
        value={params.get('status') ?? ''}
        options={STATUSES}
        onChange={(v) => push({ status: v })}
      />
    </div>
  );
}
