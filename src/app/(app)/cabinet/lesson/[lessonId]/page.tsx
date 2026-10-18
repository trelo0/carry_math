import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetLessonLoading from './loading';
import { LessonPageContent } from './LessonPageContent';

export const metadata = {
  title: 'Занятие — District',
};

export const dynamic = 'force-dynamic';

export default async function CabinetLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ login?: string; course?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { lessonId } = await params;
  const sp = await searchParams;
  const returnTo = `/cabinet/lesson/${lessonId}${sp.course ? `?course=${encodeURIComponent(sp.course)}` : ''}`;

  if (!auth.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo={returnTo} title="Занятие" />;
    }
    redirect(authLoginRedirectPath(returnTo));
  }

  const cleanPath = pathWithoutAuthLoginQuery(returnTo, sp);
  if (cleanPath) redirect(cleanPath);

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';

  return (
    <Suspense fallback={<CabinetLessonLoading />}>
      <LessonPageContent phone={phone} lessonId={lessonId} courseSlug={sp.course?.trim()} />
    </Suspense>
  );
}
