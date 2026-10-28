import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { resolveCabinetEntryPathForPhone } from '@/lib/cabinet-auth';
import CabinetBootShell from '@/components/cabinet/CabinetBootShell';
import CabinetPageContent from '@/components/cabinet/CabinetPageContent';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';

export const metadata = {
  title: 'Кабинет курса — District',
};

export const dynamic = 'force-dynamic';

const SECTIONS = ['course', 'payments', 'settings'] as const;
type CabinetSection = (typeof SECTIONS)[number];

const LEGACY_SECTION_MAP: Record<string, CabinetSection> = {
  lessons: 'course',
  schedule: 'course',
};

function parseSection(value: string | undefined): CabinetSection | undefined {
  if (!value) return undefined;
  if (SECTIONS.includes(value as CabinetSection)) return value as CabinetSection;
  return LEGACY_SECTION_MAP[value];
}

function parsePaymentResult(value: string | undefined): 'success' | 'failed' | undefined {
  if (value === 'success' || value === 'failed') return value;
  return undefined;
}

function cabinetReturnPath(sp: {
  section?: string;
  payment?: string;
  course?: string;
  cabinetPreview?: string;
}): string {
  const params = new URLSearchParams();
  const section = parseSection(sp.section);
  if (section) params.set('section', section);
  const payment = parsePaymentResult(sp.payment);
  if (payment) params.set('payment', payment);
  if (sp.course?.trim()) params.set('course', sp.course.trim());
  if (sp.cabinetPreview === 'student') params.set('cabinetPreview', 'student');
  const qs = params.toString();
  return qs ? `/cabinet?${qs}` : '/cabinet';
}

export default async function CabinetPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; login?: string; payment?: string; course?: string; cabinetPreview?: string }>;
}) {
  const sp = await searchParams;
  const returnTo = cabinetReturnPath(sp);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo={returnTo} />;
    }
    redirect(authLoginRedirectPath(returnTo));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet', sp);
  if (cleanPath) redirect(cleanPath);

  const phone =
    (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  if (admin) {
    try {
      const entryPath = await resolveCabinetEntryPathForPhone(admin, phone, returnTo);
      if (entryPath !== returnTo) {
        redirect(entryPath);
      }
    } catch {
      // service role недоступен
    }
  }

  return (
    <Suspense
      fallback={
        <CabinetBootShell
          initialSection={parseSection(sp.section)}
          courseSlug={sp.course}
        />
      }
    >
      <CabinetPageContent
        phone={phone}
        createdAt={data.user.created_at}
        courseSlug={sp.course}
        section={sp.section}
        payment={sp.payment}
        returnTo={returnTo}
        cabinetPreview={sp.cabinetPreview === 'student' ? 'student' : undefined}
      />
    </Suspense>
  );
}
