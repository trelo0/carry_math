import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { getStaffCabinetData } from '@/lib/teacher/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

export async function GET() {
  const auth = await getStaffAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getStaffCabinetData(
      auth.admin,
      auth.telegramId,
      auth.roles,
      auth.fullName,
    );
    return NextResponse.json(data);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load staff data');
  }
}
