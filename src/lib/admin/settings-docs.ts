import { createClient, type SanityClient } from 'next-sanity';
import { randomBytes } from 'node:crypto';
import forms from '@/lib/admin/sanity-forms.json';
import type { FormDoc, FormField, FormMember, SanityDocValues } from '@/lib/admin/sanity-form-types';
import {
  SETTINGS_TABS,
  findSettingsDoc,
  settingsTabDocRefs,
  type SettingsDocRef,
  type SettingsTabId,
} from '@/lib/admin/settings-sections';
import { unstable_cache } from 'next/cache';
import { isSanityWriteConfigured } from '@/lib/studio/courseContentWrite';

const FORMS = forms as unknown as Record<string, FormDoc>;

export class SettingsDocError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[],
  ) {
    super(message);
  }
}

export function getFormDoc(type: string): FormDoc | null {
  return FORMS[type] ?? null;
}

export function settingsWriteEnabled(): boolean {
  return isSanityWriteConfigured();
}

export function sanityDocsClient(mode: 'read' | 'write' = 'write'): SanityClient {
  const token =
    mode === 'write'
      ? process.env.SANITY_API_WRITE_TOKEN
      : (process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_READ_TOKEN);
  if (!token) throw new SettingsDocError('SANITY_API_WRITE_TOKEN не настроен', 503);
  return createClient({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd',
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
    apiVersion: '2024-01-01',
    token,
    useCdn: false,
    perspective: 'raw',
  });
}

export const publishedId = (id: string) => id.replace(/^drafts\./, '');

function resolveRef(type: string, id?: string | null): { ref: SettingsDocRef; form: FormDoc } {
  const ref = findSettingsDoc(type);
  const form = getFormDoc(type);
  if (!ref || !form) throw new SettingsDocError('Неизвестный тип документа', 400);
  if (ref.kind === 'single' && id && publishedId(id) !== ref.id) {
    throw new SettingsDocError('Неверный документ', 400);
  }
  return { ref, form };
}

function editableFields(form: FormDoc, ref: SettingsDocRef): FormField[] {
  return ref.onlyFields ? form.fields.filter((f) => ref.onlyFields!.includes(f.name)) : form.fields;
}

/** Документы типа (черновик Studio приоритетнее опубликованного — как видит редактор в Studio). */
export async function loadSettingsDocs(type: string): Promise<SanityDocValues[]> {
  const { ref } = resolveRef(type);
  const c = sanityDocsClient('read');
  if (ref.kind === 'single') {
    const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', { ids: [ref.id, `drafts.${ref.id}`] });
    const doc = rows.find((r) => r._id?.startsWith('drafts.')) ?? rows[0];
    return doc ? [{ ...doc, _id: ref.id }] : [];
  }
  const rows = await c.fetch<SanityDocValues[]>(
    '*[_type == $type] | order(coalesce(order, 9999) asc, _createdAt asc)',
    { type },
  );
  const map = new Map<string, SanityDocValues>();
  for (const row of rows) {
    const id = publishedId(String(row._id));
    const isDraft = String(row._id).startsWith('drafts.');
    if (!map.has(id) || isDraft) map.set(id, { ...row, _id: id });
  }
  return [...map.values()];
}

function mergeListDocs(rows: SanityDocValues[]): SanityDocValues[] {
  const map = new Map<string, SanityDocValues>();
  for (const row of rows) {
    const id = publishedId(String(row._id));
    const isDraft = String(row._id).startsWith('drafts.');
    if (!map.has(id) || isDraft) map.set(id, { ...row, _id: id });
  }
  return [...map.values()];
}

/** Один–два запроса к Sanity на вкладку вместо N отдельных. */
async function loadSettingsTabDocsUncached(refs: SettingsDocRef[]): Promise<Record<string, SanityDocValues[]>> {
  const out: Record<string, SanityDocValues[]> = {};
  if (refs.length === 0) return out;

  const c = sanityDocsClient('read');
  const singles = refs.filter((r) => r.kind === 'single');
  const lists = refs.filter((r) => r.kind === 'list');

  if (singles.length > 0) {
    const ids = singles.flatMap((r) => [r.id!, `drafts.${r.id}`]);
    const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', { ids });
    for (const ref of singles) {
      const pid = ref.id!;
      const doc = rows.find((r) => r._id === `drafts.${pid}`) ?? rows.find((r) => r._id === pid);
      out[ref.type] = doc ? [{ ...doc, _id: pid }] : [];
    }
  }

  if (lists.length > 0) {
    const types = lists.map((r) => r.type);
    const rows = await c.fetch<SanityDocValues[]>(
      '*[_type in $types] | order(coalesce(order, 9999) asc, _createdAt asc)',
      { types },
    );
    for (const ref of lists) {
      out[ref.type] = mergeListDocs(rows.filter((r) => r._type === ref.type));
    }
  }

  return out;
}

const loadSettingsTabDocsCached = unstable_cache(
  async (tabId: SettingsTabId) => {
    const tab = SETTINGS_TABS.find((t) => t.id === tabId);
    const refs = tab ? settingsTabDocRefs(tab) : [];
    if (!tab || refs.length === 0) return {};
    return loadSettingsTabDocsUncached(refs);
  },
  ['admin-settings-tab-docs'],
  { revalidate: 30, tags: ['admin-settings'] },
);

export async function loadSettingsTabDocs(tabId: SettingsTabId): Promise<Record<string, SanityDocValues[]>> {
  return loadSettingsTabDocsCached(tabId);
}

// ---------------------------------------------------------------------------
// Санитайзинг значений по описанию схемы
// ---------------------------------------------------------------------------

export type Ctx = { errors: string[] };

const key = () => randomBytes(6).toString('hex');
const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

function sanitizeScalar(field: Pick<FormField, 'type' | 'title' | 'list'>, value: unknown, ctx: Ctx, label: string): unknown {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'slug': {
      if (typeof value !== 'string') return undefined;
      const s = field.type === 'string' ? value.trim() : value.replace(/\s+$/, '');
      if (field.list && s && !field.list.some((o) => o.value === s)) {
        ctx.errors.push(`${label}: недопустимое значение`);
        return undefined;
      }
      return s || undefined;
    }
    case 'url': {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const s = value.trim();
      if (!/^(https?:\/\/|mailto:|tel:|\/)/i.test(s)) {
        ctx.errors.push(`${label}: ссылка должна начинаться с https://, mailto:, tel: или /`);
        return undefined;
      }
      return s;
    }
    case 'date':
    case 'datetime': {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const s = value.trim();
      if (Number.isNaN(Date.parse(s))) {
        ctx.errors.push(`${label}: неверная дата`);
        return undefined;
      }
      return s;
    }
    case 'number': {
      if (value === '' || value === null || value === undefined) return undefined;
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) {
        ctx.errors.push(`${label}: нужно число`);
        return undefined;
      }
      return n;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    default:
      return undefined;
  }
}

function sanitizeField(field: FormField, value: unknown, ctx: Ctx, label: string): unknown {
  let out: unknown;
  if (field.readOnly) return value;
  switch (field.type) {
    case 'image': {
      const v = value as { asset?: { _ref?: string }; hotspot?: unknown; crop?: unknown } | null;
      const ref = v?.asset?._ref;
      if (typeof ref === 'string' && /^image-/.test(ref)) {
        out = {
          _type: 'image',
          asset: { _type: 'reference', _ref: ref },
          ...(v?.hotspot ? { hotspot: v.hotspot } : {}),
          ...(v?.crop ? { crop: v.crop } : {}),
        };
      }
      break;
    }
    case 'file': {
      const ref = (value as { asset?: { _ref?: string } } | null)?.asset?._ref;
      if (typeof ref === 'string' && /^file-/.test(ref)) {
        out = { _type: 'file', asset: { _type: 'reference', _ref: ref } };
      }
      break;
    }
    case 'reference': {
      const v = value as { _ref?: string; _weak?: boolean } | null;
      if (typeof v?._ref === 'string') out = { _type: 'reference', _ref: v._ref, ...(v._weak ? { _weak: true } : {}) };
      break;
    }
    case 'object':
      out = sanitizeObject(field.fields ?? [], value, ctx, label);
      break;
    case 'array':
      out = sanitizeArray(field, value, ctx, label);
      break;
    default:
      out = sanitizeScalar(field, value, ctx, label);
  }
  if (isEmpty(out) && field.required) ctx.errors.push(`${label}: обязательное поле`);
  return isEmpty(out) && out !== false && out !== 0 ? undefined : out;
}

export function sanitizeObject(fields: FormField[], value: unknown, ctx: Ctx, label: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = sanitizeField(f, src[f.name], ctx, `${label} → ${f.title}`);
    if (v !== undefined) out[f.name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeArray(field: FormField, value: unknown, ctx: Ctx, label: string): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const members = field.of ?? [];
  const out: unknown[] = [];
  value.forEach((item, i) => {
    const itemLabel = `${label} #${i + 1}`;
    const member: FormMember | undefined =
      members.length === 1
        ? members[0]
        : members.find((m) => m.typeName && m.typeName === (item as { _type?: string })?._type) ?? members[0];
    if (!member) return;
    if (member.type === 'object') {
      const obj = sanitizeObject(member.fields ?? [], item, ctx, itemLabel);
      if (!obj) return;
      const existingKey = (item as { _key?: unknown })?._key;
      out.push({
        ...(member.typeName ? { _type: member.typeName } : {}),
        _key: typeof existingKey === 'string' && existingKey ? existingKey : key(),
        ...obj,
      });
    } else {
      const v = sanitizeScalar({ type: member.type, title: member.title ?? '' }, item, ctx, itemLabel);
      if (v !== undefined) out.push(v);
    }
  });
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

export const SYSTEM_KEYS = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt', '_system']);

/** Чистая проверка/нормализация значений по схеме (без обращения к Sanity). */
export function sanitizeSettingsValues(type: string, values: unknown): { clean: Record<string, unknown>; errors: string[] } {
  const { ref, form } = resolveRef(type);
  const ctx: Ctx = { errors: [] };
  const clean = sanitizeObject(editableFields(form, ref), values, ctx, '') ?? {};
  return { clean, errors: ctx.errors.map((e) => e.replace(/^ → /, '')) };
}

/** Сохранение = «Publish» в Studio: перезаписываем опубликованный документ, черновик удаляем. */
export async function saveSettingsDoc(args: {
  type: string;
  id?: string | null;
  values: unknown;
  rev?: string | null;
}): Promise<SanityDocValues> {
  const { ref, form } = resolveRef(args.type, args.id);
  const c = sanityDocsClient();
  const fields = editableFields(form, ref);

  const { clean, errors } = sanitizeSettingsValues(args.type, args.values);
  if (errors.length > 0) throw new SettingsDocError('Проверьте поля', 422, errors);

  const id = ref.kind === 'single' ? ref.id! : args.id ? publishedId(args.id) : null;

  if (!id) {
    const created = await c.create({ _type: args.type, ...clean });
    return created as SanityDocValues;
  }

  const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', { ids: [id, `drafts.${id}`] });
  const draft = rows.find((r) => r._id === `drafts.${id}`);
  const published = rows.find((r) => r._id === id);
  const current = draft ?? published;

  if (current && current._type !== args.type) throw new SettingsDocError('Тип документа не совпадает', 400);
  if (ref.kind === 'list' && !current) throw new SettingsDocError('Документ не найден', 404);
  if (args.rev && current && current._rev !== args.rev) {
    throw new SettingsDocError('Документ изменили в другом месте (например, в Studio). Обновите страницу.', 409);
  }

  const base: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current ?? {})) {
    if (!SYSTEM_KEYS.has(k)) base[k] = v;
  }
  for (const f of fields) delete base[f.name];

  const tx = c.transaction().createOrReplace({ _id: id, _type: args.type, ...base, ...clean });
  if (draft) tx.delete(draft._id as string);
  await tx.commit();

  const saved = await c.getDocument<SanityDocValues>(id);
  return { ...(saved as SanityDocValues), _id: id };
}

export async function deleteSettingsDoc(type: string, id: string): Promise<void> {
  const { ref } = resolveRef(type, id);
  if (ref.kind !== 'list') throw new SettingsDocError('Одиночный документ удалять нельзя', 400);
  const c = sanityDocsClient();
  const pid = publishedId(id);
  const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]{_id,_type}', { ids: [pid, `drafts.${pid}`] });
  if (rows.some((r) => r._type !== type)) throw new SettingsDocError('Тип документа не совпадает', 400);
  const tx = c.transaction();
  for (const r of rows) tx.delete(r._id as string);
  await tx.commit();
}

export async function uploadSettingsImage(file: File): Promise<{ ref: string; url: string }> {
  if (!file.type.startsWith('image/')) throw new SettingsDocError('Нужен файл-изображение', 400);
  if (file.size > 10 * 1024 * 1024) throw new SettingsDocError('Файл больше 10 МБ', 400);
  const c = sanityDocsClient();
  const asset = await c.assets.upload('image', Buffer.from(await file.arrayBuffer()), {
    filename: file.name,
    contentType: file.type,
  });
  return { ref: asset._id, url: asset.url };
}
