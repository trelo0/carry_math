import Link from 'next/link';
import type { ReactNode } from 'react';
import AdminFinanceChartSection from '@/components/admin/AdminFinanceChartSection';
import { bePaidMerchantPortalUrl } from '@/lib/bepaid/merchant-links';
import { AdminFinanceFilters, AdminFinanceTableControls } from '@/components/admin/AdminFinanceControls';
import {
  FINANCE_PAGE_SIZE,
  formatMinor,
  formatTotals,
  journalStatusLabel,
  paymentMethodLabel,
  type FinanceDashboardData,
  type FinanceFilters,
} from '@/lib/admin/bepaid-journal-data';
import { formatAdminDateTime } from '@/lib/admin/format';

const ICON = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const CARD_ICONS: Record<'site' | 'product' | 'all' | 'count', ReactNode> = {
  site: (
    <svg {...ICON}>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M7 11v4.5c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5V11" />
    </svg>
  ),
  product: (
    <svg {...ICON}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  ),
  all: (
    <svg {...ICON}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </svg>
  ),
  count: (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.6 2.6L16 9.5" />
    </svg>
  ),
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function pageList(page: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, 2, page - 1, page, page + 1, count]);
  const sorted = [...set].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

function href(f: FinanceFilters, patch: Partial<{ period: string; page: number }>): string {
  const sp = new URLSearchParams();
  const period = patch.period ?? f.period;
  if (period !== '30d') sp.set('period', period);
  if (f.source !== 'all') sp.set('source', f.source);
  if (f.method !== 'all') sp.set('method', f.method);
  if (f.status !== 'all') sp.set('status', f.status);
  if (f.q) sp.set('q', f.q);
  if (patch.page && patch.page > 1) sp.set('page', String(patch.page));
  const qs = sp.toString();
  return qs ? `/cabinet/admin/finance?${qs}` : '/cabinet/admin/finance';
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="admin-fin__delta admin-fin__delta--none">нет данных за прошлый период</span>;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`admin-fin__delta admin-fin__delta--${dir}`}>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
        <path
          d={dir === 'down' ? 'M12 5v14m0 0-6-6m6 6 6-6' : dir === 'up' ? 'M12 19V5m0 0-6 6m6-6 6 6' : 'M5 12h14'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {sign}
      {value}% <span>к прошлому периоду</span>
    </span>
  );
}

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function hue(name: string | null): number {
  let h = 0;
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function AdminFinanceDashboard({
  data,
  filters,
}: {
  data: FinanceDashboardData;
  filters: FinanceFilters;
}) {
  const { cards, chart, extra } = data;
  const page = filters.page + 1;
  const pageCount = Math.max(1, Math.ceil(data.total / FINANCE_PAGE_SIZE));
  const from = filters.page * FINANCE_PAGE_SIZE;
  const chartDefaultRange: 7 | 30 | 90 =
    filters.period === '7d' ? 7 : filters.period === '90d' ? 90 : 30;

  const statCards = [
    { key: 'site' as const, label: 'Поступления по курсу', value: formatTotals(cards.siteTotals), delta: cards.deltaSite },
    {
      key: 'product' as const,
      label: 'Поступления по занятиям',
      value: formatTotals(cards.productTotals),
      delta: cards.deltaProduct,
    },
    { key: 'all' as const, label: 'Всего поступлений', value: formatTotals(cards.allTotals), delta: cards.deltaAll },
    { key: 'count' as const, label: 'Количество оплат', value: String(cards.paidCount), delta: cards.deltaCount },
  ];

  return (
    <div className="admin-fin">
      <AdminFinanceFilters />

      {data.tableMissing ? (
        <div className="admin-fin__notice admin-fin__notice--warn">
          Таблица <code>bepaid_transactions</code> не создана. Примените <code>supabase/bepaid_journal.sql</code> в
          Supabase SQL Editor и нажмите «Обновить».
        </div>
      ) : !data.mainShopConfigured ? (
        <div className="admin-fin__notice admin-fin__notice--warn">
          Не заданы ключи bePaid (<code>BEPAY_SHOP_ID</code>, <code>BEPAY_SECRET_KEY</code>) — загрузка платежей
          недоступна.
        </div>
      ) : data.total === 0 && cards.paidCount === 0 && !data.lastSyncedAt ? (
        <div className="admin-fin__notice">
          Журнал пока пуст. Нажмите «Обновить», чтобы подтянуть платежи из bePaid за выбранный период.
        </div>
      ) : null}

      <section className="admin-fin__stats" aria-label="Статистика поступлений">
        {statCards.map((c) => (
          <div key={c.key} className={`admin-fin__stat admin-fin__stat--${c.key}`}>
            <span className="admin-fin__stat-icon">{CARD_ICONS[c.key]}</span>
            <div className="admin-fin__stat-body">
              <p className="admin-fin__stat-label">{c.label}</p>
              <p className="admin-fin__stat-value">{c.value}</p>
              <Delta value={c.delta} />
            </div>
          </div>
        ))}
      </section>

      <section className="admin-fin__card admin-fin__chart-card">
        <div className="admin-fin__card-head admin-fin__card-head--chart">
          <h2 className="admin-fin__card-title">Динамика поступлений</h2>
        </div>
        <AdminFinanceChartSection
          days={chart.days}
          currency={chart.currency}
          defaultRange={chartDefaultRange}
        />
      </section>

      <section className="admin-fin__card admin-fin__table-card">
        <div className="admin-fin__card-head">
          <h2 className="admin-fin__card-title">Платежи</h2>
          <span className="admin-fin__range">{data.periodLabel} · {data.rangeLabel}</span>
          <AdminFinanceTableControls />
        </div>

        {data.rows.length === 0 ? (
          <p className="admin-fin__empty">Платежей не найдено. Измените период, поиск или фильтры.</p>
        ) : (
          <div className="admin-courses__scroll">
            <table className="admin-courses__table admin-fin__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Ученик</th>
                  <th>Курс / Занятие</th>
                  <th className="admin-fin__num">Сумма</th>
                  <th>Способ оплаты</th>
                  <th>Статус</th>
                  <th>Зачислено</th>
                  <th aria-label="bePaid" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const refund = r.kind === 'refund' || r.status === 'refunded';
                  const amount = refund ? -Math.abs(r.amount_minor) : r.amount_minor;
                  return (
                    <tr key={r.uid} className={r.is_test ? 'admin-fin__row--test' : undefined}>
                      <td>
                        <span className="admin-courses__num">{formatAdminDateTime(r.occurred_at)}</span>
                      </td>
                      <td>
                        <span className="admin-fin__payer">
                          <span
                            className="admin-fin__avatar"
                            style={{ background: `linear-gradient(135deg, hsl(${hue(r.payer_name)} 70% 52%), hsl(${(hue(r.payer_name) + 50) % 360} 65% 40%))` }}
                            aria-hidden
                          >
                            {initials(r.payer_name)}
                          </span>
                          <span className="admin-courses__course-title">{r.payer_name ?? 'Неизвестный плательщик'}</span>
                        </span>
                      </td>
                      <td>
                        <span className="admin-courses__course-title">{r.product_title ?? 'Неизвестный продукт'}</span>
                        <span className="admin-courses__course-sub">
                          {r.source === 'site' ? 'Курс' : 'Оплата занятий'}
                          {r.is_test ? ' · тест' : ''}
                        </span>
                      </td>
                      <td className="admin-fin__num">
                        <b className={amount < 0 ? 'admin-fin__amount admin-fin__amount--neg' : 'admin-fin__amount'}>
                          {amount < 0 ? '−' : ''}
                          {formatMinor(Math.abs(amount), r.currency)}
                        </b>
                      </td>
                      <td>{paymentMethodLabel(r.payment_method)}</td>
                      <td>
                        <span className={`admin-fin__status admin-fin__status--${r.status}`}>
                          {journalStatusLabel(r.status, r.kind)}
                        </span>
                      </td>
                      <td>
                        {r.status === 'paid' ? (
                          <span className="admin-fin__credited admin-fin__credited--yes">Да</span>
                        ) : (
                          <span className="admin-fin__credited">—</span>
                        )}
                      </td>
                      <td>
                        <a
                          href={bePaidMerchantPortalUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="admin-fin__bepaid-link"
                          title={`Открыть личный кабинет bePaid. UID: ${r.uid}`}
                        >
                          bePaid
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-courses__foot">
          <span>
            {data.total > 0
              ? `Показано ${from + 1}–${from + data.rows.length} из ${data.total} ${plural(data.total, 'платежа', 'платежей', 'платежей')}`
              : 'Платежей нет'}
            {extra.pending + extra.failed + extra.cancelled > 0
              ? ` · не оплачено за период: ${extra.pending + extra.failed + extra.cancelled}`
              : ''}
            {extra.refunds > 0 ? ` · возвратов: ${extra.refunds} (${formatTotals(extra.refundTotals)})` : ''}
          </span>
          {pageCount > 1 ? (
            <nav className="admin-courses__pager" aria-label="Страницы">
              {pageList(page, pageCount).map((p, i) =>
                p === 'gap' ? (
                  <span key={`g${i}`} className="admin-courses__page admin-courses__page--gap">
                    …
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={href(filters, { page: p })}
                    className={`admin-courses__page${p === page ? ' is-active' : ''}`}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </Link>
                ),
              )}
            </nav>
          ) : null}
        </div>

        <p className="admin-fin__hint">
          В поступления входят только подтверждённые оплаты{extra.tests > 0 ? ` (тестовых платежей скрыто: ${extra.tests})` : ''}
          ; возвраты показаны отдельно со знаком «−».
          {extra.truncated ? ' Статистика посчитана по последним 20 000 транзакциям.' : ''}
          {data.lastSyncedAt ? ` Последнее обновление: ${formatAdminDateTime(data.lastSyncedAt)}.` : ''}
        </p>
      </section>
    </div>
  );
}
