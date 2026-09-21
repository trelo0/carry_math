import { NextResponse } from 'next/server';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { getCuratorCabinetData } from '@/lib/curator/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

export async function GET() {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getCuratorCabinetData(auth.admin, auth.telegramId, auth.fullName);
    return NextResponse.json(data);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load curator data');
  }
}
