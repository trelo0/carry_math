'use client';

import { useMemo, useState } from 'react';
import AdminFinanceChart from '@/components/admin/AdminFinanceChart';
import type { FinanceChartDay } from '@/lib/admin/bepaid-journal-data';

const RANGES = [
  { id: 7, label: '7 дней' },
  { id: 30, label: '30 дней' },
  { id: 90, label: '90 дней' },
] as const;

type Props = {
  days: FinanceChartDay[];
  currency: string;
  defaultRange?: 7 | 30 | 90;
};

export default function AdminFinanceChartSection({ days, currency, defaultRange = 30 }: Props) {
  const maxAvailable = days.length;
  const initial =
    defaultRange <= maxAvailable ? defaultRange : maxAvailable >= 7 ? (maxAvailable >= 30 ? 30 : 7) : maxAvailable;
  const [range, setRange] = useState<number>(initial);

  const visible = useMemo(() => {
    if (days.length === 0) return days;
    const take = Math.min(range, days.length);
    return days.slice(days.length - take);
  }, [days, range]);

  const maxMinor = visible.reduce((m, d) => Math.max(m, d.site, d.product), 0);

  return (
    <div className="admin-fin__chart-body">
      <div className="admin-fin__chart-toolbar">
        <div className="admin-fin__legend admin-fin__legend--chips" aria-label="Серии графика">
          <span className="admin-fin__legend-chip">
            <i className="admin-fin__dot admin-fin__dot--site" aria-hidden />
            По курсу
          </span>
          <span className="admin-fin__legend-chip">
            <i className="admin-fin__dot admin-fin__dot--product" aria-hidden />
            По занятиям
          </span>
        </div>
        <div className="admin-fin__seg admin-fin__seg--chart" role="group" aria-label="Период графика">
          {RANGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`admin-fin__seg-btn${range === p.id ? ' is-active' : ''}`}
              disabled={p.id > maxAvailable}
              onClick={() => setRange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {maxMinor > 0 ? (
        <AdminFinanceChart days={visible} currency={currency} />
      ) : (
        <p className="admin-fin__empty">За выбранный период поступлений нет.</p>
      )}
    </div>
  );
}
