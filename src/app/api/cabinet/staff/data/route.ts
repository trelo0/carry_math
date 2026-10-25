import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { getStaffCabinetData } from '@/lib/teacher/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

export async function GET(request: Request) {
  const auth = await getStaffAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const courseIdRaw = url.searchParams.get('courseId');
  const courseId =
    courseIdRaw != null && courseIdRaw !== '' ? Number(courseIdRaw) : undefined;
  const courseSlug = url.searchParams.get('courseSlug') ?? undefined;
  const courseRoleRaw = url.searchParams.get('courseRole');
  const courseRole =
    courseRoleRaw === 'curator' || courseRoleRaw === 'check' ? courseRoleRaw : undefined;

  try {
    const data = await getStaffCabinetData(
      auth.admin,
      auth.telegramId,
      auth.roles,
      auth.fullName,
      {
        courseId: Number.isFinite(courseId) ? courseId : undefined,
        courseSlug,
        courseRole,
        light: url.searchParams.get('light') === '1',
      },
    );
    return NextResponse.json(data);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load staff data');
  }
}
