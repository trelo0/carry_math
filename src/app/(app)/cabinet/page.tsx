import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCabinetData } from '@/lib/cabinet';
import CabinetShell from '@/components/cabinet/CabinetShell';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Личный кабинет — District',
};

export const dynamic = 'force-dynamic';

const SECTIONS = ['course', 'lessons', 'schedule', 'payments', 'settings'] as const;
type CabinetSection = (typeof SECTIONS)[number];
const PRODUCTS = ['course', 'individual', 'group'] as const;
type CabinetProduct = (typeof PRODUCTS)[number];

function parseSection(value: string | undefined): CabinetSection | undefined {
  return SECTIONS.includes(value as CabinetSection) ? (value as CabinetSection) : undefined;
}

function parseProduct(value: string | undefined): CabinetProduct | undefined {
  return PRODUCTS.includes(value as CabinetProduct) ? (value as CabinetProduct) : undefined;
}

// Личный кабинет ученика: отдельная часть сайта со своим прикладным
// интерфейсом (без маркетинговой шапки и футера).
export default async function CabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; product?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login');
  }

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  const cabinet = await getCabinetData(phone, data.user.created_at);

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate />;
  }

  const sp = await searchParams;

  return (
    <CabinetShell
      data={cabinet}
      initialSection={parseSection(sp.section)}
      initialProduct={parseProduct(sp.product)}
    />
  );
}
