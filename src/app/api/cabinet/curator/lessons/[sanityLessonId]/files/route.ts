import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { curatorJsonError } from '@/lib/curator/api-errors';
import {
  deleteCourseLessonFile,
  setCourseLessonFilePublished,
  uploadCourseLessonFile,
  type LessonContentField,
} from '@/lib/studio/courseContentWrite';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

function parseField(value: string | null): LessonContentField | null {
  if (value === 'lessonMaterials' || value === 'lessonHomeworkFiles') return value;
  return null;
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  const form = await request.formData();
  const field = parseField(form.get('field')?.toString() ?? null);
  const file = form.get('file');
  if (!field) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'File required' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadCourseLessonFile(sanityLessonId, field, buffer, file.name);
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to upload file');
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  let body: { field?: string; index?: number; published?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const field = parseField(body.field ?? null);
  const index = body.index;
  if (!field || typeof index !== 'number' || typeof body.published !== 'boolean') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    await setCourseLessonFilePublished(sanityLessonId, field, index, body.published);
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to update file');
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  const url = new URL(request.url);
  const field = parseField(url.searchParams.get('field'));
  const indexRaw = url.searchParams.get('index');
  const index = indexRaw != null ? Number(indexRaw) : NaN;
  if (!field || !Number.isInteger(index)) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }

  try {
    await deleteCourseLessonFile(sanityLessonId, field, index);
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to delete file');
  }
}
