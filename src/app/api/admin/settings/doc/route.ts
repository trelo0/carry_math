import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import {
  SettingsDocError,
  deleteSettingsDoc,
  loadSettingsDocs,
  saveSettingsDoc,
} from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

function fail(error: unknown) {
  if (error instanceof SettingsDocError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  console.error('[admin settings doc]', error);
  const message = error instanceof Error ? error.message : 'Ошибка';
  return NextResponse.json({ error: message }, { status: 500 });
}

function refreshSite() {
  revalidateTag('admin-settings', { expire: 0 });
  revalidatePath('/', 'layout');
}

/** GET ?type=review — документы типа (черновик Studio приоритетнее). */
export async function GET(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const type = new URL(request.url).searchParams.get('type') ?? '';
  try {
    return NextResponse.json({ docs: await loadSettingsDocs(type) });
  } catch (error) {
    return fail(error);
  }
}

/** PUT { type, id?, values, rev? } — сохранить и опубликовать (id нет — создать). */
export async function PUT(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { type?: string; id?: string | null; values?: unknown; rev?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  if (!body.type) return NextResponse.json({ error: 'Не указан тип' }, { status: 400 });
  try {
    const doc = await saveSettingsDoc({ type: body.type, id: body.id, values: body.values, rev: body.rev });
    refreshSite();
    return NextResponse.json({ ok: true, doc });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE ?type=review&id=... — только для списков. */
export async function DELETE(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const type = sp.get('type') ?? '';
  const id = sp.get('id') ?? '';
  if (!type || !id) return NextResponse.json({ error: 'Не указан документ' }, { status: 400 });
  try {
    await deleteSettingsDoc(type, id);
    refreshSite();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
