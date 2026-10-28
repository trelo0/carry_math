export type AdminNavSection =
  | 'courses'
  | 'people'
  | 'schedule'
  | 'finance'
  | 'settings';

export type AdminNavItem = {
  id: AdminNavSection;
  label: string;
  href: string;
  description: string;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    id: 'courses',
    label: 'Курсы',
    href: '/cabinet/admin/courses',
    description: 'Управляйте курсами, модулями, занятиями, учениками и настройками',
  },
  {
    id: 'people',
    label: 'Люди',
    href: '/cabinet/admin/people',
    description: 'Поиск и карточки участников школы',
  },
  {
    id: 'schedule',
    label: 'Расписание',
    href: '/cabinet/admin/schedule',
    description: 'Занятия преподавателей',
  },
  {
    id: 'finance',
    label: 'Финансы',
    href: '/cabinet/admin/finance',
    description: 'Поступления, платежи и финансовая статистика',
  },
  {
    id: 'settings',
    label: 'Настройки сайта',
    href: '/cabinet/admin/settings',
    description: 'Контент и параметры публичного сайта',
  },
];

export function adminNavItem(id: AdminNavSection): AdminNavItem {
  const item = ADMIN_NAV_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown admin section: ${id}`);
  return item;
}
