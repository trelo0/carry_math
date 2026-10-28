import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getAdminCabinetContext, getSupabaseAuthUser } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminShell from '@/components/admin/AdminShell';
import AdminStripLoginQuery from '@/components/admin/AdminStripLoginQuery';
import AdminUnauthHandler from '@/components/admin/AdminUnauthHandler';

async function resolveTelegramLinked(phone: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from('telegram_links')
      .select('telegram_id')
      .eq('phone', phone)
      .maybeSingle();
    return Boolean(link?.telegram_id);
  } catch {
    return false;
  }
}

/** Общий chrome панели: auth один раз, shell не пересоздаётся при смене раздела. */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminCabinetContext();

  if (!ctx) {
    const user = await getSupabaseAuthUser();
    if (!user) {
      return (
        <Suspense fallback={<div className="admin-panel__loading">…</div>}>
          <AdminUnauthHandler telegramLinked={true} />
        </Suspense>
      );
    }
    const phone = (user.user_metadata?.phone as string) ?? user.phone ?? '';
    const linked = phone ? await resolveTelegramLinked(phone) : false;
    if (!linked) {
      return (
        <Suspense fallback={<div className="admin-panel__loading">…</div>}>
          <AdminUnauthHandler telegramLinked={false} />
        </Suspense>
      );
    }
    redirect('/cabinet');
  }

  return (
    <AdminShell adminDisplayName={ctx.displayName}>
      <Suspense fallback={null}>
        <AdminStripLoginQuery />
      </Suspense>
      {children}
    </AdminShell>
  );
}
