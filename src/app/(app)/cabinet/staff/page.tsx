import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authLoginRedirectPath, pathWithoutAuthLoginQuery } from '@/lib/auth-login-redirect';
import { memberHasRole } from '@/lib/bot/roles';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { getStaffCabinetData } from '@/lib/teacher/cabinet-data';
import { parseCabinetPreview } from '@/lib/admin/settings-sections';
import { parseStaffCourseRole } from '@/lib/staff/staff-cabinet-url';
import StaffShell from '@/components/staff/StaffShell';
import CabinetLoginGate from '@/components/cabinet/CabinetLoginGate';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';

export const metadata = {
  title: 'Рабочий кабинет — District',
};

export const dynamic = 'force-dynamic';

function parseSection(value: string | undefined): string | undefined {
  return value || undefined;
}

export default async function StaffCabinetPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    tab?: string;
    lesson?: string;
    login?: string;
    courseId?: string;
    courseRole?: string;
    cabinetPreview?: string;
  }>;
}) {
  const sp = await searchParams;
  const courseRole = parseStaffCourseRole(sp.courseRole);
  const cabinetPreview = parseCabinetPreview(sp.cabinetPreview);
  const supabase = await createClient();
  const { data: authUser } = await supabase.auth.getUser();

  if (!authUser.user) {
    if (sp.login === '1') {
      return <CabinetLoginGate returnTo="/cabinet/staff" title="Рабочий кабинет" />;
    }
    redirect(authLoginRedirectPath('/cabinet/staff'));
  }

  const cleanPath = pathWithoutAuthLoginQuery('/cabinet/staff', sp);
  if (cleanPath) redirect(cleanPath);

  const staffAuth = await getStaffAuth();
  if (!staffAuth) {
    const phone =
      (authUser.user.user_metadata?.phone as string) ?? authUser.user.phone ?? '';
    try {
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const admin = createAdminClient();
      const { data: link } = await admin
        .from('telegram_links')
        .select('telegram_id')
        .eq('phone', phone)
        .maybeSingle();
      if (!link?.telegram_id) {
        return <CabinetTelegramGate returnTo="/cabinet/staff" />;
      }
    } catch {
      // fallthrough
    }
    redirect('/cabinet');
  }

  let data;
  try {
    const courseIdRaw = sp.courseId ? Number(sp.courseId) : undefined;
    data = await getStaffCabinetData(
      staffAuth.admin,
      staffAuth.telegramId,
      staffAuth.roles,
      staffAuth.fullName,
      {
        courseId: Number.isFinite(courseIdRaw) ? courseIdRaw : undefined,
        courseRole,
      },
    );
  } catch (error) {
    console.error('[cabinet/staff]', error);
    return (
      <div className="cabinet">
        <div className="cab-main cab-tg-gate-wrap">
          <section className="cab-panel cab-tg-gate">
            <h1>Рабочий кабинет временно недоступен</h1>
            <p>Не удалось загрузить данные. Проверьте подключение к Sanity и Supabase.</p>
          </section>
        </div>
      </div>
    );
  }

  const hasTeacher = Boolean(data.teacher);
  const hasCuratorWeb = Boolean(
    data.curator && data.curator.assignedCourses.some((c) => c.role === 'curator'),
  );
  if (!hasTeacher && !hasCuratorWeb && !data.fullStaffPreview) {
    redirect('/cabinet');
  }

  return (
    <StaffShell
      data={data}
      initialSection={parseSection(sp.section)}
      initialTab={sp.tab}
      initialLessonId={sp.lesson}
      initialCourseId={
        sp.courseId && Number.isFinite(Number(sp.courseId)) ? Number(sp.courseId) : undefined
      }
      initialCourseRole={courseRole}
      cabinetPreview={cabinetPreview === 'curator' || cabinetPreview === 'teacher' ? cabinetPreview : null}
      showCabinetPick={
        memberHasRole(staffAuth.roles, 'admin') &&
        (cabinetPreview === 'curator' || cabinetPreview === 'teacher')
      }
    />
  );
}
