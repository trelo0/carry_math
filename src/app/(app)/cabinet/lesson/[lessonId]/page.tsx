import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { getCabinetLessonPageData } from '@/lib/cabinet';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CabinetLessonDetail from '@/components/cabinet/CabinetLessonDetail';
import CabinetLessonBackLink from '@/components/cabinet/CabinetLessonBackLink';

export const metadata = {
  title: 'Занятие — District',
};

export const dynamic = 'force-dynamic';

export default async function CabinetLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ login?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { lessonId } = await params;
  const sp = await searchParams;
  const returnTo = `/cabinet/lesson/${lessonId}`;
  if (!auth.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo={returnTo} title="Занятие" />;
    }
    redirect(authLoginRedirectPath(returnTo));
  }

  const cleanPath = pathWithoutAuthLoginQuery(returnTo, sp);
  if (cleanPath) redirect(cleanPath);

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  const pageData = await getCabinetLessonPageData(phone, lessonId);
  if (!pageData) return <CabinetTelegramGate />;

  const { stop, courseModules, courseCatalog } = pageData;
  // sequential unlock: locked всегда закрыт (раньше full обходил гейт и давал 403 на watch)
  const locked = stop.status === 'locked';
  const module = courseModules[stop.module] ?? null;

  return (
    <div className="cab-lespage">
      <div className="cab-lespage-inner">
        <header className="cab-lespage-head">
          <CabinetLessonBackLink />
          <span className="cab-k">
            {`M${stop.module + 1} · ${String(stop.numInModule).padStart(2, '0')} · ${module?.name ?? 'Модуль'}`}
          </span>
          <h1>{stop.title}</h1>
        </header>

        {locked ? (
          <section className="cab-panel cab-lespage-locked">
            <h2>Занятие пока закрыто</h2>
            <p>
              Пройдите предыдущие занятия и сдайте ДЗ, либо оплатите пакет занятий, чтобы открыть
              следующее.
            </p>
            <Link className="cab-btn cab-btn--join" href="/cabinet?section=payments&product=course">
              Оплатить занятия
            </Link>
          </section>
        ) : (
          <CabinetLessonDetail
            stop={stop}
            coverUrl={courseCatalog?.coverImageUrl ?? courseCatalog?.previewImageUrl ?? null}
            coursePurchased={pageData.courseState === 'full'}
          />
        )}
      </div>
    </div>
  );
}
