import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCabinetData } from '@/lib/cabinet';
import CabinetShell from '@/components/cabinet/CabinetShell';

export const metadata = {
  title: 'Личный кабинет — District',
};

// Личный кабинет ученика: отдельная часть сайта со своим прикладным
// интерфейсом (без маркетинговой шапки и футера).
export default async function CabinetPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login');
  }

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  return <CabinetShell data={cabinet} />;
}
