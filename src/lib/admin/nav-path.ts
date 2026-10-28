import { ADMIN_NAV_ITEMS, type AdminNavItem, type AdminNavSection } from '@/lib/admin/nav';

export function adminSectionFromPathname(pathname: string): AdminNavSection {
  for (const item of ADMIN_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return item.id;
    }
  }
  return 'courses';
}

export function adminNavForPathname(pathname: string): AdminNavItem {
  const id = adminSectionFromPathname(pathname);
  return ADMIN_NAV_ITEMS.find((i) => i.id === id) ?? ADMIN_NAV_ITEMS[0];
}
