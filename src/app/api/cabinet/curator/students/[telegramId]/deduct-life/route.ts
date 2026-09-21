import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { deductLifeForHomeworkDebtByCurator } from '@/lib/bot/education/course-homework';
import { curatorJsonError } from '@/lib/curator/api-errors';

type RouteParams = { params: Promise<{ telegramId: string }> };

type Body = { sanityLessonId?: string };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.sanityLessonId) {
    return NextResponse.json({ error: 'sanityLessonId required' }, { status: 400 });
  }

  try {
    const result = await deductLifeForHomeworkDebtByCurator(
      auth.admin,
      auth.telegramId,
      studentTelegramId,
      body.sanityLessonId,
    );
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return curatorJsonError(error, 'Failed to deduct life');
  }
}
