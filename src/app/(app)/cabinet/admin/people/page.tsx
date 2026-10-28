import { redirect } from 'next/navigation';
import AdminPeopleBrowser from '@/components/admin/AdminPeopleBrowser';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { listAdminPeopleCached, type AdminPersonListRow } from '@/lib/admin/people-data';

export const dynamic = 'force-dynamic';

export default async function AdminPeoplePage() {
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  let rows: AdminPersonListRow[] = [];
  let failure: string | null = null;
  try {
    rows = await listAdminPeopleCached();
  } catch (e) {
    failure = e instanceof Error ? e.message : 'Не удалось загрузить список';
  }

  if (failure) {
    return (
      <div className="admin-panel__card admin-panel__empty">
        <p className="admin-panel__empty-title">Ошибка загрузки</p>
        <p className="admin-panel__empty-text">{failure}</p>
      </div>
    );
  }
  return <AdminPeopleBrowser rows={rows} />;
}
