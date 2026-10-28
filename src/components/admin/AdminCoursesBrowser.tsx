'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import AdminAvatarStack from '@/components/admin/AdminAvatarStack';
import AdminCourseCreateModal from '@/components/admin/AdminCourseCreateModal';
import { AdminSelect, type SelectOption } from '@/components/admin/AdminUi';
import type { AdminCourseListItem } from '@/lib/admin/courses-data';

const PAGE_SIZE = 8;

const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Все статусы' },
  { value: 'Открытый', label: 'Открытый' },
  { value: 'Закрытый', label: 'Закрытый' },
  { value: 'Архив', label: 'Архив' },
];

function CourseIcon({ item }: { item: AdminCourseListItem }) {
  if (item.coverImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="admin-courses__icon" src={item.coverImageUrl} alt="" loading="lazy" />;
  }
  const hue = (item.courseId * 53) % 360;
  return (
    <span className="admin-courses__icon" style={{ background: `hsl(${hue} 55% 42%)` }} aria-hidden>
      {item.title.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

type Props = {
  items: AdminCourseListItem[];
  writeEnabled: boolean;
};

export default function AdminCoursesBrowser({ items, writeEnabled }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const deferredQ = useDeferredValue(q);

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
    return items.filter((c) => {
      if (needle && !c.title.toLowerCase().includes(needle) && !c.slug.toLowerCase().includes(needle)) return false;
      if (status && c.accessLabel !== status) return false;
      return true;
    });
  }, [items, deferredQ, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * PAGE_SIZE;
  const rows = filtered.slice(from, from + PAGE_SIZE);

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
            placeholder="Поиск по названию курса..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <AdminSelect
          label="Статус"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <button type="button" className="admin-courses__create" onClick={() => setCreating(true)}>
          <span aria-hidden>+</span> Создать курс
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-panel__card admin-panel__empty">
          <p className="admin-panel__empty-title">Курсы не найдены</p>
          <p className="admin-panel__empty-text">
            {items.length === 0 ? 'Курсов в Sanity пока нет — создайте первый.' : 'Измените поиск или фильтры.'}
          </p>
        </div>
      ) : (
        <div className="admin-courses__table-card">
          <div className="admin-courses__scroll">
            <table className="admin-courses__table">
              <thead>
                <tr>
                  <th>Курс</th>
                  <th>Статус</th>
                  <th>Ученики</th>
                  <th>Модули / Занятия</th>
                  <th>Преподаватели</th>
                  <th>Проверяющие</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.courseId}>
                    <td>
                      <Link
                        href={`/cabinet/admin/courses/${c.courseId}/overview`}
                        className="admin-courses__course"
                        prefetch={false}
                      >
                        <CourseIcon item={c} />
                        <span>
                          <span className="admin-courses__course-title">{c.title}</span>
                          <span className="admin-courses__course-sub">{c.subtitle ?? c.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className={`admin-courses__access admin-courses__access--${c.accessTone}`}>
                        {c.accessLabel}
                      </span>
                      <span className="admin-courses__num-sub">{c.accessHint}</span>
                    </td>
                    <td>
                      <span className="admin-courses__num">{c.activeStudents}</span>
                      <span className="admin-courses__num-sub">учеников</span>
                    </td>
                    <td>
                      <span className="admin-courses__num">
                        {c.moduleCount} / {c.lessonCount}
                      </span>
                      <span className="admin-courses__num-sub">модули / занятия</span>
                    </td>
                    <td>
                      <AdminAvatarStack people={c.teachers} />
                    </td>
                    <td>
                      <AdminAvatarStack people={c.checkers} />
                    </td>
                    <td className="admin-courses__actions">
                      <Link
                        href={`/cabinet/admin/courses/${c.courseId}/overview`}
                        className="admin-courses__action-btn"
                        prefetch={false}
                      >
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
              Показано {from + 1}–{from + rows.length} из {filtered.length} курсов
            </span>
            {pageCount > 1 ? (
              <nav className="admin-courses__pager" aria-label="Страницы">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`admin-courses__page${p === current ? ' is-active' : ''}`}
                    aria-current={p === current ? 'page' : undefined}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
      )}

      <AdminCourseCreateModal open={creating} onClose={() => setCreating(false)} writeEnabled={writeEnabled} />
    </>
  );
}
