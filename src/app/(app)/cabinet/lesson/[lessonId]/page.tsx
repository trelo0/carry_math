import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCabinetLessonPageData } from '@/lib/cabinet';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CabinetLessonDetail from '@/components/cabinet/CabinetLessonDetail';

export const metadata = {
  title: 'Занятие — District',
};

export const dynamic = 'force-dynamic';

export default async function CabinetLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  const { lessonId } = await params;
  const pageData = await getCabinetLessonPageData(phone, lessonId);
  if (!pageData) return <CabinetTelegramGate />;

  const { stop, courseModules, courseCatalog, courseState } = pageData;
  const locked = courseState !== 'full' && stop.status === 'locked';
  const module = courseModules[stop.module] ?? null;

  return (
    <div className="cab-lespage">
      <div className="cab-lespage-inner">
        <header className="cab-lespage-head">
          <Link href="/cabinet?section=course" className="cab-lespage-back">
            ← Личный кабинет
          </Link>
          <span className="cab-k">
            {`M${stop.module + 1} · ${String(stop.numInModule).padStart(2, '0')} · ${module?.name ?? 'Модуль'}`}
          </span>
          <h1>{stop.title}</h1>
        </header>

        {locked ? (
          <section className="cab-panel cab-lespage-locked">
            <h2>Занятие пока закрыто</h2>
            <p>Купи курс, чтобы открыть вебинар, материалы и домашние задания.</p>
            <Link className="cab-btn cab-btn--join" href="/cabinet?section=payments&product=course">
              Купить курс
            </Link>
          </section>
        ) : (
          <CabinetLessonDetail
            stop={stop}
            coverUrl={courseCatalog?.coverImageUrl ?? courseCatalog?.previewImageUrl ?? null}
          />
        )}
      </div>
    </div>
  );
}
