import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Legacy URL → единый staff-кабинет. */
export default async function CuratorLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; lesson?: string; login?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.section) {
    const map: Record<string, string> = {
      dashboard: 'course-overview',
      lessons: 'course-lessons',
      students: 'course-students',
      homework: 'course-homework',
      settings: 'settings',
      'teacher-home': 'teacher-calendar',
      'teacher-schedule': 'teacher-calendar',
      'teacher-availability': 'teacher-calendar',
      'curator-dashboard': 'course-overview',
      'curator-lessons': 'course-lessons',
      'curator-students': 'course-students',
      'curator-homework': 'course-homework',
    };
    params.set('section', map[sp.section] ?? sp.section);
  }
  if (sp.lesson) params.set('lesson', sp.lesson);
  if (sp.login) params.set('login', sp.login);
  const qs = params.toString();
  redirect(qs ? `/cabinet/staff?${qs}` : '/cabinet/staff');
}
