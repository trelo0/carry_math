'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { suffix: 'overview', label: 'Обзор' },
  { suffix: 'program', label: 'Программа' },
  { suffix: 'students', label: 'Ученики' },
  { suffix: 'team', label: 'Сотрудники' },
  { suffix: 'pricing', label: 'Цены' },
  { suffix: 'publish', label: 'Настройки' },
] as const;

type Props = {
  courseId: number;
};

export default function AdminCourseSubNav({ courseId }: Props) {
  const pathname = usePathname();
  const base = `/cabinet/admin/courses/${courseId}`;

  return (
    <nav className="admin-course__tabs" aria-label="Разделы курса">
      {TABS.map((tab) => {
        const href = `${base}/${tab.suffix}`;
        const active =
          pathname === href ||
          (tab.suffix === 'students'
            ? pathname.startsWith(`${base}/students`)
            : pathname.startsWith(`${href}/`));
        return (
          <Link
            key={tab.suffix}
            href={href}
            prefetch={false}
            className={`admin-course__tab${active ? ' is-active' : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
