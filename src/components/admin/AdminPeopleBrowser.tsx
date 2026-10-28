'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { PersonAvatar, RoleBadge } from '@/components/admin/AdminPeopleParts';
import { AdminSelect, type SelectOption } from '@/components/admin/AdminUi';
import type { AdminPersonListRow } from '@/lib/admin/people-data';
import { ASSIGNABLE_ROLES, ROLE_TITLES } from '@/lib/admin/people-roles';

const PAGE_SIZE = 8;

const ROLE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Все роли' },
  ...ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_TITLES[r] })),
];

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

export default function AdminPeopleBrowser({ rows }: { rows: AdminPersonListRow[] }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const deferredQ = useDeferredValue(q);

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase().replace(/^[@#]/, '');
    const digits = needle.replace(/\D/g, '');
    return rows.filter((p) => {
      // Роль ищем и по основной, и по дополнительным.
      if (role && !p.roles.some((r) => r.role === role)) return false;
      if (!needle) return true;
      if (p.name.toLowerCase().includes(needle)) return true;
      if (String(p.telegramId).includes(needle)) return true;
      return digits.length > 0 && (p.phone ?? '').replace(/\D/g, '').includes(digits);
    });
  }, [rows, deferredQ, role]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * PAGE_SIZE;
  const visible = filtered.slice(from, from + PAGE_SIZE);

  return (
    <>
      <div className="admin-courses__toolbar">
        <label className="admin-courses__search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Поиск по имени, телефону или ID..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <AdminSelect
          label="Роль"
          value={role}
          options={ROLE_OPTIONS}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="admin-panel__card admin-panel__empty">
          <p className="admin-panel__empty-title">Никого не найдено</p>
          <p className="admin-panel__empty-text">Измените поиск или фильтр роли.</p>
        </div>
      ) : (
        <div className="admin-courses__table-card">
          <div className="admin-courses__scroll">
            <table className="admin-courses__table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роли</th>
                  <th>Последняя активность</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.telegramId}>
                    <td>
                      <Link href={`/cabinet/admin/people/${p.telegramId}`} className="admin-courses__course" prefetch={false}>
                        <PersonAvatar telegramId={p.telegramId} name={p.name} />
                        <span>
                          <span className="admin-courses__course-title">{p.name}</span>
                          <span className="admin-courses__course-sub">{p.phone ?? '—'}</span>
                          <span className="admin-courses__course-sub">
                            ID {p.telegramId}
                            {p.telegramLinked ? '' : ' · нет Telegram'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <div className="admin-role__list">
                        {p.roles.map((r) => (
                          <RoleBadge key={r.role} badge={r} />
                        ))}
                      </div>
                    </td>
                    <td>
                      {p.activity ? (
                        <>
                          <span className="admin-courses__num admin-people__when">{p.activity.whenLabel}</span>
                          <span className="admin-courses__num-sub">{p.activity.note}</span>
                        </>
                      ) : (
                        <span className="admin-panel__cell-muted">—</span>
                      )}
                    </td>
                    <td className="admin-courses__actions">
                      <Link href={`/cabinet/admin/people/${p.telegramId}`} className="admin-courses__action-btn" prefetch={false}>
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-courses__foot">
            <span>
              Показано {from + 1}–{from + visible.length} из {filtered.length}{' '}
              {plural(filtered.length, 'человека', 'человек', 'человек')}
            </span>
            {pageCount > 1 ? (
              <nav className="admin-courses__pager" aria-label="Страницы">
                {pageList(current, pageCount).map((p, i) =>
                  p === 'gap' ? (
                    <span key={`g${i}`} className="admin-courses__page admin-courses__page--gap">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className={`admin-courses__page${p === current ? ' is-active' : ''}`}
                      aria-current={p === current ? 'page' : undefined}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  ),
                )}
              </nav>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
