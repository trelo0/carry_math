import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import type { FormDoc, FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';
import {
  SYSTEM_KEYS,
  SettingsDocError,
  getFormDoc,
  publishedId,
  sanitizeObject,
  sanityDocsClient,
  type Ctx,
} from '@/lib/admin/settings-docs';

export type CourseScope = 'overview' | 'pricing' | 'access' | 'staff' | 'module' | 'lesson';

type ScopeDef = { type: 'districtCourse' | 'districtModule' | 'districtCourseLesson'; fields: string[] };

export const COURSE_SCOPES: Record<CourseScope, ScopeDef> = {
  overview: {
    type: 'districtCourse',
    fields: ['title', 'cabinetEyebrow', 'description', 'coverImage', 'deliveryFormat', 'cabinetPreviewInside'],
  },
  pricing: { type: 'districtCourse', fields: ['pricing', 'purchaseScenarios'] },
  access: { type: 'districtCourse', fields: ['showInCatalog', 'courseClosed'] },
  staff: { type: 'districtCourse', fields: ['curator', 'curatorTelegramId', 'checkTelegramId'] },
  module: { type: 'districtModule', fields: ['title', 'color', 'sortOrder'] },
  lesson: {
    type: 'districtCourseLesson',
    fields: [
      'title',
      'description',
      'moduleOrder',
      'isTrialFree',
      'lessonDate',
      'liveUrl',
      'recordingUrl',
      'contentChips',
      'lessonMaterials',
      'lessonHomeworkFiles',
    ],
  },
};

export function courseScopeFields(scope: CourseScope): { form: FormDoc; fields: FormField[] } {
  const def = COURSE_SCOPES[scope];
  const form = getFormDoc(def.type);
  if (!form) throw new SettingsDocError('Схема не найдена', 500);
  return { form, fields: form.fields.filter((f) => def.fields.includes(f.name)) };
}

const rnd = () => randomBytes(6).toString('hex');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function revalidateCourses(): void {
  revalidateTag('admin-panel-course-list', { expire: 0 });
  revalidateTag('admin-course-program', { expire: 0 });
  revalidateTag('sanity:course-content', { expire: 0 });
  revalidatePath('/cabinet', 'layout');
}

/** Документ курса/модуля/занятия: черновик Studio приоритетнее опубликованного. */
export async function loadCourseDocs(ids: string[]): Promise<Map<string, SanityDocValues>> {
  const c = sanityDocsClient('read');
  const want = ids.flatMap((id) => [publishedId(id), `drafts.${publishedId(id)}`]);
  const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', { ids: want });
  return mergeDrafts(rows);
}

function mergeDrafts(rows: SanityDocValues[]): Map<string, SanityDocValues> {
  const map = new Map<string, SanityDocValues>();
  for (const row of rows) {
    const id = publishedId(String(row._id));
    const isDraft = String(row._id).startsWith('drafts.');
    if (!map.has(id) || isDraft) map.set(id, { ...row, _id: id });
  }
  return map;
}

export function slugOf(doc: SanityDocValues | null | undefined): string {
  const s = doc?.slug as { current?: string } | undefined;
  return s?.current ?? '';
}

// ---------------------------------------------------------------------------
// Создание курса
// ---------------------------------------------------------------------------

export type CreateCourseInput = {
  title: string;
  cabinetEyebrow?: string;
  description?: string;
  coverImageRef?: string | null;
  deliveryFormat?: string;
  slug: string;
};

export async function createCourse(
  admin: SupabaseClient,
  input: CreateCourseInput,
): Promise<{ courseId: number; sanityId: string; slug: string }> {
  const title = input.title?.trim();
  const slug = input.slug?.trim().toLowerCase();
  if (!title) throw new SettingsDocError('Укажите название курса', 422);
  if (!slug || !SLUG_RE.test(slug) || slug.length > 96) {
    throw new SettingsDocError('Код курса: латиница, цифры и дефисы (например algebra-2026)', 422);
  }

  const c = sanityDocsClient();
  const taken = await c.fetch<number>('count(*[_type == "districtCourse" && slug.current == $slug])', { slug });
  if (taken > 0) throw new SettingsDocError('Курс с таким кодом уже есть в Sanity', 409);
  const { data: existing } = await admin.from('courses').select('id').eq('slug', slug).maybeSingle();
  if (existing) throw new SettingsDocError('Курс с таким кодом уже есть в базе', 409);

  const cover = input.coverImageRef?.trim();
  const doc = await c.create({
    _type: 'districtCourse',
    title,
    slug: { _type: 'slug', current: slug },
    cabinetEyebrow: input.cabinetEyebrow?.trim() || 'Курс подготовки',
    deliveryFormat: input.deliveryFormat?.trim() || 'Онлайн',
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(cover && /^image-/.test(cover)
      ? { coverImage: { _type: 'image', asset: { _type: 'reference', _ref: cover } } }
      : {}),
    // Создаётся закрытым: никто, кроме команды, курс не видит, пока его не откроют в «Настройках».
    courseClosed: true,
    showInCatalog: true,
    // Скрытое поле: без него код кабинета считает документ черновиком.
    publicationStatus: 'published',
  });

  const { data: row, error } = await admin
    .from('courses')
    .insert({
      title,
      slug,
      description: input.description?.trim() || null,
      sanity_id: doc._id,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !row) {
    // Не оставляем «сиротский» документ без записи в базе.
    await c.delete(doc._id).catch(() => undefined);
    throw new SettingsDocError(error?.message ?? 'Не удалось создать запись курса', 500);
  }

  revalidateCourses();
  return { courseId: row.id as number, sanityId: doc._id, slug };
}

// ---------------------------------------------------------------------------
// Сохранение полей курса / модуля / занятия
// ---------------------------------------------------------------------------

async function nextModuleSortOrder(courseId: string): Promise<number> {
  const c = sanityDocsClient('read');
  const top = await c.fetch<number | null>(
    '*[_type == "districtModule" && course._ref == $courseId] | order(sortOrder desc)[0].sortOrder',
    { courseId },
  );
  return (typeof top === 'number' && Number.isFinite(top) ? top : -1) + 1;
}

async function nextLessonOrder(moduleId: string): Promise<number> {
  const c = sanityDocsClient('read');
  const top = await c.fetch<number | null>(
    '*[_type == "districtCourseLesson" && module._ref == $moduleId] | order(moduleOrder desc)[0].moduleOrder',
    { moduleId },
  );
  return (typeof top === 'number' && Number.isFinite(top) ? top : 0) + 1;
}

async function appendLessonToModule(moduleId: string, lessonId: string): Promise<void> {
  const c = sanityDocsClient();
  const ids = [moduleId, `drafts.${moduleId}`];
  const mods = await c.fetch<Array<{ _id: string; lessons?: Array<{ _ref?: string }> }>>(
    '*[_id in $ids]{_id, lessons}',
    { ids },
  );
  const tx = c.transaction();
  for (const m of mods) {
    if ((m.lessons ?? []).some((r) => r._ref === lessonId)) continue;
    tx.patch(m._id, (p) =>
      p.set({
        lessons: [
          ...(m.lessons ?? []),
          { _type: 'reference', _ref: lessonId, _weak: true, _key: `lesson-${lessonId}` },
        ],
      }),
    );
  }
  if (mods.length > 0) await tx.commit();
}

export type SaveCourseDocArgs = {
  scope: CourseScope;
  /** Для существующего документа. Для нового модуля/занятия не передаётся. */
  id?: string | null;
  /** Курс (для нового модуля) или модуль (для нового занятия): sanity _id. */
  parentId?: string | null;
  values: unknown;
  rev?: string | null;
};

function ensureKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = ensureKeys(v) as Record<string, unknown>;
        return '_key' in o ? o : { ...o, _key: rnd() };
      }
      return v;
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, ensureKeys(v)]));
  }
  return value;
}

/** «Сохранить и опубликовать»: перезаписываем опубликованный документ, черновик Studio удаляем. */
export async function saveCourseDoc(args: SaveCourseDocArgs): Promise<SanityDocValues> {
  const def = COURSE_SCOPES[args.scope];
  if (!def) throw new SettingsDocError('Неизвестный раздел', 400);
  const { fields } = courseScopeFields(args.scope);
  const c = sanityDocsClient();

  const ctx: Ctx = { errors: [] };
  const clean = sanitizeObject(fields, args.values, ctx, '') ?? {};
  if (ctx.errors.length > 0) {
    throw new SettingsDocError('Проверьте поля', 422, ctx.errors.map((e) => e.replace(/^ → /, '')));
  }
  const cleanKeyed = ensureKeys(clean) as Record<string, unknown>;

  // ---- создание ----
  if (!args.id) {
    if (args.scope === 'module') {
      const parent = args.parentId ? publishedId(args.parentId) : '';
      if (!parent) throw new SettingsDocError('Не указан курс', 400);
      if (!cleanKeyed.title) throw new SettingsDocError('Укажите название модуля', 422);
      const created = await c.create({
        _type: 'districtModule',
        color: '#38c6ff',
        ...cleanKeyed,
        sortOrder: typeof cleanKeyed.sortOrder === 'number' ? cleanKeyed.sortOrder : await nextModuleSortOrder(parent),
        course: { _type: 'reference', _ref: parent, _weak: true },
      });
      revalidateCourses();
      return created as SanityDocValues;
    }
    if (args.scope === 'lesson') {
      const parent = args.parentId ? publishedId(args.parentId) : '';
      if (!parent) throw new SettingsDocError('Не указан модуль', 422);
      if (!cleanKeyed.title) throw new SettingsDocError('Укажите название занятия', 422);
      const created = await c.create({
        _type: 'districtCourseLesson',
        lessonType: 'webinar',
        publicationStatus: 'published',
        mandatoryHomework: true,
        contentChips: ['Теория', 'Разбор задач', 'Практика', 'Домашнее задание'],
        isTrialFree: false,
        ...cleanKeyed,
        moduleOrder: typeof cleanKeyed.moduleOrder === 'number' ? cleanKeyed.moduleOrder : await nextLessonOrder(parent),
        module: { _type: 'reference', _ref: parent, _weak: true },
      });
      await appendLessonToModule(parent, created._id);
      revalidateCourses();
      return created as SanityDocValues;
    }
    throw new SettingsDocError('Курс создаётся отдельной формой', 400);
  }

  // ---- обновление ----
  const id = publishedId(args.id);
  const rows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', { ids: [id, `drafts.${id}`] });
  const draft = rows.find((r) => r._id === `drafts.${id}`);
  const published = rows.find((r) => r._id === id);
  const current = draft ?? published;
  if (!current) throw new SettingsDocError('Документ не найден в Sanity', 404);
  if (current._type !== def.type) throw new SettingsDocError('Тип документа не совпадает', 400);
  if (args.rev == null || String(args.rev).trim() === '') {
    throw new SettingsDocError('Обновите страницу и сохраните снова.', 409);
  }
  if (current._rev !== args.rev) {
    throw new SettingsDocError('Документ изменили в другом месте (например, в Studio). Обновите страницу.', 409);
  }

  const base: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) if (!SYSTEM_KEYS.has(k)) base[k] = v;
  for (const f of fields) delete base[f.name];

  // Ссылка на преподавателя (teacher) хранится как reference — не затираем, если форма её не меняла.
  const merged = { _id: id, _type: def.type, ...base, ...cleanKeyed };
  const tx = c.transaction().createOrReplace(merged as never);
  if (draft) tx.delete(draft._id as string);
  await tx.commit();

  const saved = await c.getDocument<SanityDocValues>(id);
  revalidateCourses();
  return { ...(saved as SanityDocValues), _id: id };
}

// ---------------------------------------------------------------------------
// Программа курса
// ---------------------------------------------------------------------------

export type ProgramLesson = {
  id: string;
  rev: string;
  title: string;
  description: string;
  moduleOrder: number;
  isTrialFree: boolean;
  lessonDate: string;
  liveUrl: string;
  recordingUrl: string;
  chips: string[];
  materials: ProgramFile[];
  homework: ProgramFile[];
};

export type ProgramFile = {
  key: string;
  ref: string;
  name: string;
  size: number | null;
  published: boolean;
};

export type ProgramModule = {
  id: string;
  rev: string;
  title: string;
  color: string;
  sortOrder: number;
  lessons: ProgramLesson[];
};

function moduleLessonRefs(module: SanityDocValues): string[] {
  return ((module.lessons as Array<{ _ref?: string }> | undefined) ?? [])
    .map((r) => r._ref)
    .filter((id): id is string => typeof id === 'string')
    .map(publishedId);
}

/** Модули и занятия курса прямо из Sanity (опубликованные + черновики Studio). */
export async function loadCourseProgram(courseSanityId: string): Promise<ProgramModule[]> {
  const c = sanityDocsClient('read');
  const courseId = publishedId(courseSanityId);

  const courseRows = await c.fetch<SanityDocValues[]>('*[_id in $ids]', {
    ids: [courseId, `drafts.${courseId}`],
  });
  const course = [...mergeDrafts(courseRows).values()][0];
  const embeddedModuleIds = ((course?.modules as Array<{ _ref?: string }> | undefined) ?? [])
    .map((r) => r._ref)
    .filter((id): id is string => typeof id === 'string')
    .map(publishedId);

  const modRows = await c.fetch<SanityDocValues[]>(
    embeddedModuleIds.length > 0
      ? '*[_type == "districtModule" && (course._ref == $courseId || _id in $embeddedIds)]'
      : '*[_type == "districtModule" && course._ref == $courseId]',
    embeddedModuleIds.length > 0
      ? { courseId, embeddedIds: embeddedModuleIds }
      : { courseId },
  );
  const modules = [...mergeDrafts(modRows).values()];
  if (modules.length === 0) return [];

  const lessonIdsFromModules = new Set<string>();
  for (const m of modules) {
    for (const id of moduleLessonRefs(m)) lessonIdsFromModules.add(id);
  }
  const moduleIds = modules.map((m) => String(m._id));

  const lessonRows =
    lessonIdsFromModules.size > 0
      ? await c.fetch<SanityDocValues[]>(
          '*[_type == "districtCourseLesson" && (module._ref in $moduleIds || _id in $lessonIds)]',
          { moduleIds, lessonIds: [...lessonIdsFromModules] },
        )
      : await c.fetch<SanityDocValues[]>(
          '*[_type == "districtCourseLesson" && module._ref in $moduleIds]',
          { moduleIds },
        );
  const lessons = [...mergeDrafts(lessonRows).values()];

  const fileRefs = new Set<string>();
  for (const l of lessons) {
    for (const f of ['lessonMaterials', 'lessonHomeworkFiles']) {
      for (const item of (l[f] as Array<{ file?: { asset?: { _ref?: string } } }> | undefined) ?? []) {
        const ref = item?.file?.asset?._ref;
        if (ref) fileRefs.add(ref);
      }
    }
  }
  const meta = new Map<string, { name: string; size: number | null }>();
  if (fileRefs.size > 0) {
    const assets = await c.fetch<Array<{ _id: string; originalFilename?: string; size?: number }>>(
      '*[_id in $ids]{_id, originalFilename, size}',
      { ids: [...fileRefs] },
    );
    for (const a of assets) meta.set(a._id, { name: a.originalFilename ?? 'Файл', size: a.size ?? null });
  }
  const files = (raw: unknown): ProgramFile[] =>
    ((raw as Array<{ _key?: string; published?: boolean; file?: { asset?: { _ref?: string } } }> | undefined) ?? [])
      .filter((i) => i?.file?.asset?._ref)
      .map((i, idx) => {
        const ref = i.file!.asset!._ref!;
        return {
          key: i._key ?? `f${idx}`,
          ref,
          name: meta.get(ref)?.name ?? 'Файл',
          size: meta.get(ref)?.size ?? null,
          published: i.published === true,
        };
      });

  return modules
    .map((m) => ({
      id: String(m._id),
      rev: String(m._rev ?? ''),
      title: String(m.title ?? ''),
      color: String(m.color ?? '#38c6ff'),
      sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : 0,
      lessons: lessons
        .filter((l) => {
          const lid = String(l._id);
          const ref = (l.module as { _ref?: string } | undefined)?._ref;
          if (ref === m._id) return true;
          return moduleLessonRefs(m).includes(lid);
        })
        .map((l) => ({
          id: String(l._id),
          rev: String(l._rev ?? ''),
          title: String(l.title ?? ''),
          description: String(l.description ?? ''),
          moduleOrder: typeof l.moduleOrder === 'number' ? l.moduleOrder : 0,
          isTrialFree: l.isTrialFree === true,
          lessonDate: String(l.lessonDate ?? ''),
          liveUrl: String(l.liveUrl ?? ''),
          recordingUrl: String(l.recordingUrl ?? ''),
          chips: Array.isArray(l.contentChips) ? (l.contentChips as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          materials: files(l.lessonMaterials),
          homework: files(l.lessonHomeworkFiles),
        }))
        .sort((a, b) => a.moduleOrder - b.moduleOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Кэш 60 с; сбрасывается тегом при любом сохранении из панели. */
export const loadCourseProgramCached = unstable_cache(loadCourseProgram, ['admin-course-program'], {
  revalidate: 60,
  tags: ['admin-course-program'],
});

// ---------------------------------------------------------------------------
// Удаление (как «Удалить …» в Studio: каскад + снятие ссылок)
// ---------------------------------------------------------------------------

type Ref = { _ref?: string };

const pair = (id: string) => [publishedId(id), `drafts.${publishedId(id)}`];
const dropRefs = (list: Ref[] | undefined, drop: Set<string>) => (list ?? []).filter((r) => !r?._ref || !drop.has(r._ref));

export type DeleteEntity = 'course' | 'module' | 'lesson';

export async function deleteCourseEntity(entity: DeleteEntity, rawId: string): Promise<{ deleted: number }> {
  const c = sanityDocsClient();
  const id = publishedId(rawId);
  const expected = { course: 'districtCourse', module: 'districtModule', lesson: 'districtCourseLesson' }[entity];

  const head = await c.fetch<Array<{ _id: string; _type: string }>>('*[_id in $ids]{_id,_type}', { ids: pair(id) });
  if (head.length === 0) throw new SettingsDocError('Документ уже удалён или не найден', 404);
  if (head.some((h) => h._type !== expected)) throw new SettingsDocError('Тип документа не совпадает', 400);

  const tx = c.transaction();
  let deleted = 0;
  const del = (docId: string) => {
    tx.delete(docId);
    deleted += 1;
  };

  if (entity === 'lesson') {
    const mods = await c.fetch<Array<{ _id: string; lessons?: Ref[] }>>(
      '*[_type == "districtModule" && count(lessons[_ref in $ids]) > 0]{_id, lessons}',
      { ids: pair(id) },
    );
    const drop = new Set(pair(id));
    for (const m of mods) tx.patch(m._id, (p) => p.set({ lessons: dropRefs(m.lessons, drop) }));
    for (const d of pair(id)) del(d);
  }

  if (entity === 'module') {
    const lessons = await c.fetch<Array<{ _id: string }>>(
      '*[_type == "districtCourseLesson" && module._ref in $ids]{_id}',
      { ids: pair(id) },
    );
    const lessonIds = [...new Set(lessons.map((l) => publishedId(l._id)))];
    const overrides = await c.fetch<Array<{ _id: string }>>(
      '*[_type == "districtCourse" && activeModuleOverride._ref in $ids]{_id}',
      { ids: pair(id) },
    );
    for (const o of overrides) tx.patch(o._id, (p) => p.unset(['activeModuleOverride']));
    for (const l of lessonIds) for (const d of pair(l)) del(d);
    for (const d of pair(id)) del(d);
  }

  if (entity === 'course') {
    const modules = await c.fetch<Array<{ _id: string }>>(
      '*[_type == "districtModule" && course._ref in $ids]{_id}',
      { ids: pair(id) },
    );
    const moduleIds = [...new Set(modules.map((m) => publishedId(m._id)))];
    const lessons = moduleIds.length
      ? await c.fetch<Array<{ _id: string }>>(
          '*[_type == "districtCourseLesson" && module._ref in $ids]{_id}',
          { ids: moduleIds.flatMap(pair) },
        )
      : [];
    const lessonIds = [...new Set(lessons.map((l) => publishedId(l._id)))];
    for (const l of lessonIds) for (const d of pair(l)) del(d);
    for (const m of moduleIds) for (const d of pair(m)) del(d);
    for (const d of pair(id)) del(d);
  }

  await tx.commit();
  revalidateCourses();
  return { deleted };
}

/** Загрузка файла (материалы/ДЗ занятия) в Sanity assets. */
export async function uploadCourseFile(file: File): Promise<{ ref: string; name: string; size: number }> {
  if (file.size > 100 * 1024 * 1024) throw new SettingsDocError('Файл больше 100 МБ', 400);
  const c = sanityDocsClient();
  const asset = await c.assets.upload('file', Buffer.from(await file.arrayBuffer()), {
    filename: file.name,
    contentType: file.type || undefined,
  });
  return { ref: asset._id, name: file.name, size: file.size };
}