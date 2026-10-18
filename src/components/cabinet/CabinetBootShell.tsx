'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  CabinetBootAside,
  CabinetCourseLoadBody,
} from '@/components/cabinet/CabinetLoadPlaceholders';

type BootSection = 'course' | 'payments' | 'settings';

const NAV_GROUPS = [
  {
    label: 'Обучение',
    items: [
      { id: 'course' as const, label: 'Курс' },
      { id: 'payments' as const, label: 'Оплаты' },
    ],
  },
  {
    label: 'Аккаунт',
    items: [{ id: 'settings' as const, label: 'Настройки' }],
  },
] as const;

function normalizeSection(value: string | undefined): BootSection {
  if (value === 'payments' || value === 'settings') return value;
  return 'course';
}

export default function CabinetBootShell({
  initialSection,
  courseSlug,
}: {
  initialSection?: string;
  courseSlug?: string;
}) {
  const section = normalizeSection(initialSection);

  useEffect(() => {
    document.documentElement.classList.add('cab-app');
    document.body.classList.add('cab-app');
    return () => {
      document.documentElement.classList.remove('cab-app');
      document.body.classList.remove('cab-app');
    };
  }, []);

  useEffect(() => {
    const fromQuery =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('course')?.trim()
        : '';
    const slug = courseSlug?.trim() || fromQuery || '';
    if (!slug) return;
    void fetch(`/api/cabinet/course/map-progress?course=${encodeURIComponent(slug)}`, {
      credentials: 'same-origin',
      priority: 'high',
    } as RequestInit);
  }, [courseSlug]);

  return (
    <div className="cabinet" aria-busy="true" aria-label="Загрузка кабинета">
      <aside className="cab-sidebar">
        <Link className="cab-brand" href="/" title="Вернуться на сайт">
          <span className="logo-icon" aria-hidden="true" />
          <span className="cab-brand-name">DISTRICT</span>
        </Link>
        <nav className="cab-nav" aria-label="Разделы кабинета">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="cab-nav-group">
              <span className="cab-nav-head">{group.label}</span>
              {group.items.map((item) => (
                <span
                  key={item.id}
                  className={`cab-nav-item${section === item.id ? ' is-active' : ''}`}
                  aria-disabled="true"
                >
                  <span className="cab-nav-label">{item.label}</span>
                </span>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="cab-main">
        <header className="cab-pagehead">
          <Link className="cab-home-link" href="/" title="Вернуться на главную">
            <span className="cab-home-link-label">На главную</span>
          </Link>
        </header>

        <div className="cab-body">
          <main className="cab-content">
            <CabinetCourseLoadBody />
          </main>
        </div>
      </div>

      <CabinetBootAside />
    </div>
  );
}
