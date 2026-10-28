'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_NAV_ITEMS, type AdminNavSection } from '@/lib/admin/nav';
import { adminNavForPathname, adminSectionFromPathname } from '@/lib/admin/nav-path';
import { createClient } from '@/lib/supabase/client';

type Props = {
  adminDisplayName: string | null;
  children: React.ReactNode;
};

function displayAdminLabel(name: string | null): string {
  const trimmed = name?.trim();
  if (trimmed && trimmed.length >= 2 && !trimmed.startsWith('ID ')) return trimmed;
  return 'Администратор';
}

function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join(''))
    .filter(Boolean);
  if (parts.length === 0) return 'А';
  return (Array.from(parts[0])[0] + (Array.from(parts[1] ?? '')[0] ?? '')).toUpperCase();
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const NAV_ICONS: Record<AdminNavSection, React.ReactNode> = {
  courses: (
    <svg {...ICON_PROPS}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  ),
  people: (
    <svg {...ICON_PROPS}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M17 14.5c2.4 0 4 1.7 4 4.5" />
    </svg>
  ),
  schedule: (
    <svg {...ICON_PROPS}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  ),
  finance: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  settings: (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
};

const COLLAPSE_KEY = 'admin-sidebar-collapsed';

export default function AdminShell({ adminDisplayName, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const section = adminSectionFromPathname(pathname);
  const nav = adminNavForPathname(pathname);
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // localStorage недоступен
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const closeNav = useCallback(() => setNavOpen(false), []);
  const label = displayAdminLabel(adminDisplayName);
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.push('/');
  }

  return (
    <div
      className={`admin-panel${navOpen ? ' admin-panel--nav-open' : ''}${collapsed ? ' admin-panel--collapsed' : ''}`}
    >
      <aside id="admin-panel-nav" className="admin-panel__sidebar" aria-label="Разделы панели">
        <div className="admin-panel__brand">
          <span className="admin-panel__brand-mark" aria-hidden>
            D
          </span>
          <div className="admin-panel__brand-text">
            <p className="admin-panel__brand-title">District</p>
            <p className="admin-panel__brand-sub">Административная панель</p>
          </div>
          <button
            type="button"
            className="admin-panel__collapse-btn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-pressed={collapsed}
          >
            <svg {...ICON_PROPS} width={16} height={16}>
              <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
            </svg>
          </button>
        </div>
        <nav className="admin-panel__nav">
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              prefetch={false}
              className={`admin-panel__nav-link${item.id === section ? ' is-active' : ''}`}
              onClick={closeNav}
              title={item.label}
            >
              {NAV_ICONS[item.id]}
              <span className="admin-panel__nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="admin-panel__sidebar-foot">
          {botUrl ? (
            <a
              href={botUrl}
              target="_blank"
              rel="noreferrer"
              className="admin-panel__foot-link"
              title="Telegram — открыть бота"
            >
              <span className="admin-panel__tg" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.5 4.3 2.9 11.5c-.9.4-.9 1.1-.2 1.3l4.7 1.5 1.8 5.5c.2.6.4.8.8.8.4 0 .6-.2.9-.4l2.2-2.1 4.6 3.4c.8.5 1.5.2 1.7-.8l3-14.3c.3-1.2-.4-1.8-1.9-1.1zM9 14l9.2-5.8c.4-.3.8-.1.5.2L11 15.6l-.3 3.2z" />
                </svg>
              </span>
              <span className="admin-panel__foot-text">
                <span className="admin-panel__foot-title">Telegram</span>
                <span className="admin-panel__foot-sub">Открыть бота</span>
              </span>
            </a>
          ) : null}
        </div>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className="admin-panel__backdrop"
          aria-label="Закрыть меню"
          onClick={closeNav}
        />
      ) : null}

      <div className="admin-panel__main">
        <header className="admin-panel__header">
          <button
            type="button"
            className="admin-panel__menu-btn"
            aria-expanded={navOpen}
            aria-controls="admin-panel-nav"
            onClick={() => setNavOpen((v) => !v)}
          >
            Меню
          </button>
          <div className="admin-panel__header-titles">
            <h1 className="admin-panel__page-title">{nav.label}</h1>
            <p className="admin-panel__page-desc">{nav.description}</p>
          </div>
          <div className="admin-panel__admin-chip" title="Текущий пользователь">
            <span className="admin-panel__avatar" aria-hidden>
              {initialsOf(label)}
            </span>
            <span>
              <span className="admin-panel__chip-name">{label}</span>
              <span className="admin-panel__chip-role">Администратор</span>
            </span>
          </div>
          <button
            type="button"
            className="admin-panel__logout"
            onClick={() => void signOut()}
            disabled={signingOut}
            aria-label="Выйти"
            title="Выйти"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
            </svg>
          </button>
        </header>
        <main className="admin-panel__content">{children}</main>
      </div>
    </div>
  );
}
