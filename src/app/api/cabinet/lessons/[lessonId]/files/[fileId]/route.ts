import { NextResponse } from 'next/server';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import type { CabinetLessonFileKind } from '@/lib/cabinet-lesson-files';
import { resolveLessonFileDownloadUrl } from '@/lib/lesson-file-download';

type RouteParams = { params: Promise<{ lessonId: string; fileId: string }> };

function parseKind(value: string | null): CabinetLessonFileKind {
  return value === 'homework' ? 'homework' : 'material';
}

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await getCabinetAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { lessonId, fileId } = await params;
  const lessonIdNum = Number(lessonId);
  const fileIdNum = Number(fileId);
  if (!Number.isFinite(lessonIdNum) || !Number.isFinite(fileIdNum)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const kind = parseKind(new URL(request.url).searchParams.get('kind'));

  try {
    const url = await resolveLessonFileDownloadUrl(auth.admin, {
      telegramId: auth.telegramId,
      lessonId: lessonIdNum,
      fileId: fileIdNum,
      kind,
    });
    if (!url) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[lessons/files]', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
