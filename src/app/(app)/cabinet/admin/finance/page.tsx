import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import AdminFinanceDashboard from '@/components/admin/AdminFinanceDashboard';
import { loadFinanceDashboard, parseFinanceFilters } from '@/lib/admin/bepaid-journal-data';
import { getAdminCabinetContext } from '@/lib/admin/auth';

export const dynamic = 'force-dynamic';

async function FinanceBody({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  const filters = parseFinanceFilters(searchParams);
  const data = await loadFinanceDashboard(ctx.admin, filters);
  return <AdminFinanceDashboard data={data} filters={filters} />;
}

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<div className="admin-panel__loading">Загрузка…</div>}>
      <FinanceBody searchParams={sp} />
    </Suspense>
  );
}
