import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { SettingsDocError, uploadSettingsImage } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET ?ref=image-... — превью (датасет приватный, поэтому отдаём через сервер с токеном). */
export async function GET(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  if (!/^image-[A-Za-z0-9]+-\d+x\d+-[a-z0-9]+$/.test(ref)) {
    return NextResponse.json({ error: 'Неверная ссылка' }, { status: 400 });
  }
  const [, hash, size, ext] = ref.match(/^image-([A-Za-z0-9]+)-(\d+x\d+)-([a-z0-9]+)$/)!;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_READ_TOKEN;
  const upstream = await fetch(
    `https://cdn.sanity.io/images/${projectId}/${dataset}/${hash}-${size}.${ext}?w=600&fit=max`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/** POST multipart/form-data { file } — загрузка изображения в Sanity assets. */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await uploadSettingsImage(file)) });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin settings image]', error);
    return NextResponse.json({ error: 'Не удалось загрузить изображение' }, { status: 500 });
  }
}
