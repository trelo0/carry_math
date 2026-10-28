import AdminCoursesBrowser from '@/components/admin/AdminCoursesBrowser';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { fetchAdminCourseList, type AdminCourseListItem } from '@/lib/admin/courses-data';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminCoursesPage() {
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  let items: AdminCourseListItem[] = [];
  let failure: string | null = null;
  try {
    items = await fetchAdminCourseList(ctx.admin);
  } catch (e) {
    failure = e instanceof Error ? e.message : 'Не удалось загрузить курсы';
  }

  if (failure) {
    return (
      <div className="admin-panel__card admin-panel__empty">
        <p className="admin-panel__empty-title">Ошибка загрузки</p>
        <p className="admin-panel__empty-text">{failure}</p>
      </div>
    );
  }
  return <AdminCoursesBrowser items={items} writeEnabled={settingsWriteEnabled()} />;
}
