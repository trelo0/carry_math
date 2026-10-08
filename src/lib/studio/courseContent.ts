// src/lib/studio/courseContent.ts
import { cache } from 'react';
import { groq } from 'next-sanity';
import { getSanityClient } from './sanityClient';

export const DISTRICT_COURSE_SLUG = 'district-course';
export const DISTRICT_COURSE_DOC_ID = 'districtCourse.district-course';
export const DEFAULT_LESSON_CONTENT_CHIPS = [
  'Теория',
  'Разбор задач',
  'Практика',
  'Домашнее задание',
] as const;

export type SanityLessonType = 'webinar' | 'practice' | 'test' | 'assignment';
export type SanityPublicationStatus = 'draft' | 'published' | 'archived';

export type CourseLessonMaterial = {
  title: string;
  materialType: 'file' | 'link' | 'text';
  url: string | null;
  fileName: string | null;
  fileSize: string | null;
};

export type CourseLessonHomework = {
  title: string;
  description: string | null;
  fileName: string | null;
  fileSize: string | null;
  url: string | null;
  mandatory: boolean;
};

export type CourseLessonContent = {
  sanityId: string;
  title: string;
  description: string | null;
  lessonNumber: number;
  lessonDate: string | null;
  curriculumBlock: string | null;
  moduleOrder: number;
  lessonType: SanityLessonType;
  publicationStatus: SanityPublicationStatus;
  sortOrder: number;
  isTrialFree: boolean;
  scheduledAt: string | null;
  liveUrl: string | null;
  recordingUrl: string | null;
  mandatoryHomework: boolean;
  contentChips: string[];
  materials: CourseLessonMaterial[];
  homeworkFiles: CourseLessonMaterial[];
  homework: CourseLessonHomework | null;
};

export type CourseModuleContent = {
  sanityId: string;
  title: string;
  description: string | null;
  color: string;
  sortOrder: number;
  lessons: CourseLessonContent[];
};

/** Карточка «Что внутри» в превью курса. */
export type CoursePreviewInsideItem = {
  title: string;
  description: string | null;
};

function normalizePreviewInsideItems(raw: unknown): CoursePreviewInsideItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CoursePreviewInsideItem[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const title = item.trim();
      if (title) out.push({ title, description: null });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const row = item as { title?: unknown; description?: unknown; text?: unknown };
    const title =
      (typeof row.title === 'string' && row.title.trim()) ||
      (typeof row.text === 'string' && row.text.trim()) ||
      '';
    if (!title) continue;
    const description =
      typeof row.description === 'string' && row.description.trim()
        ? row.description.trim()
        : null;
    out.push({ title, description });
  }
  return out;
}

export type DistrictCourseContent = {
  sanityId: string;
  title: string;
  slug: string;
  description: string | null;
  cabinetEyebrow: string | null;
  deliveryFormat: string | null;
  homeworkIntro: string | null;
  coverImageUrl: string | null;
  previewImageUrl: string | null;
  previewInsideItems: CoursePreviewInsideItem[];
  previewAfterEnrollment: string | null;
  previewAudience: string | null;
  publicationStatus: SanityPublicationStatus;
  curatorName: string | null;
  /** Telegram ID куратора этого курса (Sanity). */
  curatorTelegramId: number | null;
  /** Цена оплаты в кабинете (BYN). */
  priceByn: number | null;
  /** Сколько занятий выдаётся после оплаты. */
  grantedLessons: number | null;
  /** Текст на карточке оплаты. */
  pricingCardText: string | null;
  modules: CourseModuleContent[];
};

/** Карточка оффера курса для раздела оплат / checkout. */
export type CoursePaymentOffer = {
  sanityId: string;
  slug: string;
  title: string;
  description: string | null;
  /** Текст карточки оплаты (отдельно от описания курса). */
  cardText: string | null;
  priceByn: number;
  grantedLessons: number;
};

type FetchOptions = { preview?: boolean; includeDrafts?: boolean };

function getClient({ preview, includeDrafts }: FetchOptions = {}) {
  return getSanityClient({ preview, includeDrafts: includeDrafts ?? Boolean(preview) });
}

function getSanityFetchOptions({ preview }: FetchOptions) {
  return { cache: 'no-store' as const };
}

const LESSON_FIELDS = groq`{
  "sanityId": _id,
  title,
  description,
  lessonNumber,
  lessonDate,
  curriculumBlock,
  moduleOrder,
  lessonType,
  publicationStatus,
  sortOrder,
  isTrialFree,
  scheduledAt,
  liveUrl,
  recordingUrl,
  mandatoryHomework,
  contentChips,
  lessonMaterials[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  lessonHomeworkFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  lessonFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  "materialsFileUrl": materialsFile.asset->url,
  "materialsFileName": materialsFile.asset->originalFilename,
  "homeworkFileUrl": homeworkFile.asset->url,
  "homeworkFileName": homeworkFile.asset->originalFilename,
  materials[]{
    title,
    materialType,
    url,
    fileName,
    fileSize
  },
  homework{
    title,
    description,
    fileName,
    fileSize,
    url,
    mandatory
  }
}`;

const MODULE_FIELDS = groq`{
  "sanityId": _id,
  title,
  description,
  color,
  sortOrder,
  "lessons": *[_type == "districtCourseLesson" && module._ref == ^._id] | order(moduleOrder asc) ${LESSON_FIELDS}
}`;

const COURSE_CONTENT_QUERY = groq`*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  cabinetEyebrow,
  deliveryFormat,
  homeworkIntro,
  publicationStatus,
  priceByn,
  grantedLessons,
  pricing,
  "coverImageUrl": coverImage.asset->url,
  "previewImageUrl": coalesce(cabinetPreviewImage.asset->url, coverImage.asset->url),
  cabinetPreviewInside,
  cabinetPreviewAfterEnrollment,
  cabinetPreviewAudience,
  "curatorName": curator->name,
  curatorTelegramId,
  "modulesFromCourse": modules[]->${MODULE_FIELDS},
  "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) ${MODULE_FIELDS}
}`;

/** Лёгкий список курсов для переключателя — счётчики без выгрузки всех уроков. */
const COURSE_SUMMARIES_QUERY = groq`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  cabinetEyebrow,
  deliveryFormat,
  homeworkIntro,
  publicationStatus,
  "coverImageUrl": coverImage.asset->url,
  "previewImageUrl": coalesce(cabinetPreviewImage.asset->url, coverImage.asset->url),
  cabinetPreviewInside,
  cabinetPreviewAfterEnrollment,
  cabinetPreviewAudience,
  "curatorName": curator->name,
  curatorTelegramId,
  "moduleCount": count(coalesce(modules, *[_type == "districtModule" && course._ref == ^._id])),
  "totalLessons": count(*[_type == "districtCourseLesson" && (
    module._ref in coalesce(modules[]._ref, []) ||
    module->course._ref == ^._id
  ) && publicationStatus != "archived"])
}`;

const COURSE_OFFERS_QUERY = groq`*[_type == "districtCourse" && defined(slug.current) && (
  (defined(pricing.priceByn) && pricing.priceByn >= 0 && defined(pricing.grantedLessons) && pricing.grantedLessons > 0) ||
  (defined(priceByn) && priceByn >= 0 && defined(grantedLessons) && grantedLessons > 0)
)] | order(title asc) {
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  pricing,
  priceByn,
  grantedLessons
}`;

function resolveCoursePricing(raw: {
  pricing?: { priceByn?: number; grantedLessons?: number; cardText?: string | null } | null;
  priceByn?: number;
  grantedLessons?: number;
}): { priceByn: number | null; grantedLessons: number | null; cardText: string | null } {
  const nested = raw.pricing;
  const price =
    typeof nested?.priceByn === 'number' && Number.isFinite(nested.priceByn)
      ? nested.priceByn
      : typeof raw.priceByn === 'number' && Number.isFinite(raw.priceByn)
        ? raw.priceByn
        : null;
  const lessons =
    typeof nested?.grantedLessons === 'number' &&
    Number.isFinite(nested.grantedLessons) &&
    nested.grantedLessons > 0
      ? Math.floor(nested.grantedLessons)
      : typeof raw.grantedLessons === 'number' &&
          Number.isFinite(raw.grantedLessons) &&
          raw.grantedLessons > 0
        ? Math.floor(raw.grantedLessons)
        : null;
  const cardText = nested?.cardText?.trim() || null;
  return { priceByn: price, grantedLessons: lessons, cardText };
}

function normalizeLesson(raw: Record<string, unknown> | null): CourseLessonContent | null {
  if (!raw?.sanityId || !raw.title) return null;
  const hw = raw.homework as Record<string, unknown> | null;
  return {
    sanityId: raw.sanityId as string,
    title: raw.title as string,
    description: (raw.description as string | null) ?? null,
    lessonNumber: (raw.lessonNumber as number) ?? (raw.sortOrder as number) ?? 0,
    lessonDate: (raw.lessonDate as string | null) ?? null,
    curriculumBlock: (raw.curriculumBlock as string | null) ?? null,
    moduleOrder: (raw.moduleOrder as number) ?? 0,
    lessonType: (raw.lessonType as SanityLessonType) ?? 'webinar',
    publicationStatus: (raw.publicationStatus as SanityPublicationStatus) ?? 'draft',
    sortOrder: (raw.sortOrder as number) ?? (raw.lessonNumber as number) ?? 0,
    isTrialFree: Boolean(raw.isTrialFree),
    scheduledAt:
      (raw.scheduledAt as string | null) ??
      ((raw.lessonDate as string | null) ? `${raw.lessonDate as string}T18:00:00+03:00` : null),
    liveUrl: (raw.liveUrl as string | null) ?? null,
    recordingUrl: (raw.recordingUrl as string | null) ?? null,
    mandatoryHomework: Boolean(raw.mandatoryHomework ?? hw?.mandatory ?? true),
    contentChips: ((raw.contentChips as string[] | null) ?? []).filter(Boolean),
    materials: buildLessonMaterials(raw),
    homeworkFiles: buildLessonHomeworkFiles(raw),
    homework: buildLessonHomework(raw),
  };
}

type LessonFileRaw = {
  published?: boolean | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

function formatAssetSize(bytes: unknown): string | null {
  const n = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export type CuratorRawLessonFile = {
  fileName: string | null;
  fileUrl: string | null;
  published: boolean;
};

function mapRawLessonFiles(raw: unknown, requirePublished: boolean): CuratorRawLessonFile[] {
  return ((raw as LessonFileRaw[] | null) ?? [])
    .filter((f) => f?.fileUrl && (!requirePublished || f.published))
    .map((f) => ({
      fileName: f.fileName ?? 'Файл',
      fileUrl: f.fileUrl ?? null,
      published: Boolean(f.published),
    }));
}

function parsePublishedLessonFiles(raw: unknown): CourseLessonMaterial[] {
  return mapRawLessonFiles(raw, true).map((f) => ({
    title: f.fileName ?? 'Файл',
    materialType: 'file' as const,
    url: f.fileUrl,
    fileName: f.fileName,
    fileSize: null,
  }));
}

function buildLessonMaterials(raw: Record<string, unknown>): CourseLessonMaterial[] {
  if (raw.lessonMaterials != null) {
    return parsePublishedLessonFiles(raw.lessonMaterials);
  }
  if (raw.lessonFiles != null) {
    return parsePublishedLessonFiles(raw.lessonFiles);
  }

  const materialsUrl = raw.materialsFileUrl as string | null;
  if (materialsUrl) {
    const fileName = (raw.materialsFileName as string | null) ?? 'Материалы';
    return [{ title: fileName, materialType: 'file', url: materialsUrl, fileName, fileSize: null }];
  }

  return ((raw.materials as CourseLessonMaterial[] | null) ?? []).map((m) => ({
    title: m.title,
    materialType: m.materialType ?? 'file',
    url: m.url ?? null,
    fileName: m.fileName ?? null,
    fileSize: m.fileSize ?? null,
  }));
}

function buildLessonHomeworkFiles(raw: Record<string, unknown>): CourseLessonMaterial[] {
  if (raw.lessonHomeworkFiles != null) {
    return parsePublishedLessonFiles(raw.lessonHomeworkFiles);
  }

  const fileUrl = raw.homeworkFileUrl as string | null;
  if (fileUrl) {
    const fileName = (raw.homeworkFileName as string | null) ?? 'Домашнее задание';
    return [{ title: fileName, materialType: 'file', url: fileUrl, fileName, fileSize: null }];
  }

  const hw = raw.homework as Record<string, unknown> | null;
  if (hw?.url) {
    const fileName = (hw.fileName as string | null) ?? (hw.title as string | null) ?? 'Домашнее задание';
    return [{
      title: fileName,
      materialType: 'file',
      url: hw.url as string,
      fileName,
      fileSize: (hw.fileSize as string | null) ?? null,
    }];
  }

  return [];
}

function buildLessonHomework(raw: Record<string, unknown>): CourseLessonHomework | null {
  const homeworkFiles = buildLessonHomeworkFiles(raw);
  if (homeworkFiles.length > 0) {
    const first = homeworkFiles[0];
    return {
      title: first.fileName ?? first.title,
      description: null,
      fileName: first.fileName,
      fileSize: first.fileSize,
      url: first.url,
      mandatory: true,
    };
  }

  const hw = raw.homework as Record<string, unknown> | null;
  if (!hw?.title && !hw?.url) return null;
  return {
    title: (hw.title as string) ?? 'Домашнее задание',
    description: (hw.description as string | null) ?? null,
    fileName: (hw.fileName as string | null) ?? null,
    fileSize: (hw.fileSize as string | null) ?? null,
    url: (hw.url as string | null) ?? null,
    mandatory: Boolean(hw.mandatory ?? true),
  };
}

function normalizeCourse(raw: Record<string, unknown> | null): DistrictCourseContent | null {
  if (!raw?.sanityId || !raw.title || !raw.slug) return null;

  const modulesFromCourse = (raw.modulesFromCourse as Record<string, unknown>[] | null) ?? [];
  const modulesFromRefs = (raw.modulesFromRefs as Record<string, unknown>[] | null) ?? [];
  const modulesRaw = modulesFromCourse.length ? modulesFromCourse : modulesFromRefs;
  const modules: CourseModuleContent[] = modulesRaw
    .filter(Boolean)
    .map((mod, mi) => {
      const lessonsRaw = (mod.lessons as Record<string, unknown>[] | null) ?? [];
      const lessons = lessonsRaw
        .map(normalizeLesson)
        .filter((l): l is CourseLessonContent => l !== null)
        .sort((a, b) => a.lessonNumber - b.lessonNumber || a.sortOrder - b.sortOrder);
      return {
        sanityId: mod.sanityId as string,
        title: mod.title as string,
        description: (mod.description as string | null) ?? null,
        color: (mod.color as string) ?? '#4f7cff',
        sortOrder: (mod.sortOrder as number) ?? mi,
        lessons,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const pricing = resolveCoursePricing(
    raw as {
      pricing?: { priceByn?: number; grantedLessons?: number; cardText?: string | null } | null;
      priceByn?: number;
      grantedLessons?: number;
    },
  );

  return {
    sanityId: raw.sanityId as string,
    title: raw.title as string,
    slug: raw.slug as string,
    description: (raw.description as string | null) ?? null,
    cabinetEyebrow: (raw.cabinetEyebrow as string | null) ?? null,
    deliveryFormat: (raw.deliveryFormat as string | null) ?? null,
    homeworkIntro: (raw.homeworkIntro as string | null) ?? null,
    coverImageUrl: (raw.coverImageUrl as string | null) ?? null,
    previewImageUrl: (raw.previewImageUrl as string | null) ?? null,
    previewInsideItems: normalizePreviewInsideItems(raw.cabinetPreviewInside),
    previewAfterEnrollment: (raw.cabinetPreviewAfterEnrollment as string | null) ?? null,
    previewAudience: (raw.cabinetPreviewAudience as string | null) ?? null,
    publicationStatus: (raw.publicationStatus as SanityPublicationStatus) ?? 'draft',
    curatorName: (raw.curatorName as string | null) ?? null,
    curatorTelegramId:
      typeof raw.curatorTelegramId === 'number' && Number.isFinite(raw.curatorTelegramId)
        ? (raw.curatorTelegramId as number)
        : null,
    priceByn: pricing.priceByn,
    grantedLessons: pricing.grantedLessons,
    pricingCardText: pricing.cardText,
    modules,
  };
}

const CURATOR_LESSON_FILES_QUERY = groq`*[_type == "districtCourseLesson" && _id in $ids]{
  "sanityId": _id,
  lessonMaterials[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename
  },
  lessonHomeworkFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename
  }
}`;

export type CuratorLessonFilesBundle = {
  materials: CuratorRawLessonFile[];
  homeworkFiles: CuratorRawLessonFile[];
};

/** Все файлы занятий (включая неопубликованные) для кабинета куратора. */
export async function fetchCuratorLessonFilesMap(
  sanityLessonIds: string[],
): Promise<Map<string, CuratorLessonFilesBundle>> {
  const out = new Map<string, CuratorLessonFilesBundle>();
  if (sanityLessonIds.length === 0) return out;

  const client = getClient({ includeDrafts: true, preview: false });
  const rows = await client.fetch<
    {
      sanityId: string;
      lessonMaterials?: unknown;
      lessonHomeworkFiles?: unknown;
    }[]
  >(CURATOR_LESSON_FILES_QUERY, { ids: sanityLessonIds }, { cache: 'no-store' });

  for (const row of rows ?? []) {
    out.set(row.sanityId, {
      materials: mapRawLessonFiles(row.lessonMaterials, false),
      homeworkFiles: mapRawLessonFiles(row.lessonHomeworkFiles, false),
    });
  }
  return out;
}

/** Контент курса из Sanity для кабинета (без фильтра по статусу — фильтруем в коде). */
export const getDistrictCourseContent = cache(async function getDistrictCourseContent(
  slug = DISTRICT_COURSE_SLUG,
  options: FetchOptions = {},
): Promise<DistrictCourseContent | null> {
  const client = getClient(options);
  const docId = slug === DISTRICT_COURSE_SLUG ? DISTRICT_COURSE_DOC_ID : `districtCourse.${slug}`;
  const raw = await client.fetch<Record<string, unknown> | null>(
    COURSE_CONTENT_QUERY,
    { slug, docId },
    getSanityFetchOptions(options),
  );
  return normalizeCourse(raw);
});

export type DistrictCourseSummary = {
  sanityId: string;
  title: string;
  slug: string;
  description: string | null;
  cabinetEyebrow: string | null;
  deliveryFormat: string | null;
  homeworkIntro: string | null;
  publicationStatus: SanityPublicationStatus;
  coverImageUrl: string | null;
  previewImageUrl: string | null;
  previewInsideItems: CoursePreviewInsideItem[];
  previewAfterEnrollment: string | null;
  previewAudience: string | null;
  curatorName: string | null;
  curatorTelegramId: number | null;
  moduleCount: number;
  totalLessons: number;
  modulePreviews: {
    name: string;
    about: string;
    count: number;
    color: string;
    period: string | null;
    lessons: { title: string }[];
  }[];
};

/** Лёгкий список всех курсов для переключателя в кабинете. */
export const listDistrictCourseSummaries = cache(async function listDistrictCourseSummaries(
  options: FetchOptions = {},
): Promise<DistrictCourseSummary[]> {
  const client = getClient(options);
  const rows = await client.fetch<Record<string, unknown>[]>(
    COURSE_SUMMARIES_QUERY,
    {},
    getSanityFetchOptions(options),
  );

  const out: DistrictCourseSummary[] = [];
  for (const raw of rows ?? []) {
    if (!raw?.sanityId || !raw.title || !raw.slug) continue;
    out.push({
      sanityId: raw.sanityId as string,
      title: raw.title as string,
      slug: raw.slug as string,
      description: (raw.description as string | null) ?? null,
      cabinetEyebrow: (raw.cabinetEyebrow as string | null) ?? null,
      deliveryFormat: (raw.deliveryFormat as string | null) ?? null,
      homeworkIntro: (raw.homeworkIntro as string | null) ?? null,
      publicationStatus: (raw.publicationStatus as SanityPublicationStatus) ?? 'draft',
      coverImageUrl: (raw.coverImageUrl as string | null) ?? null,
      previewImageUrl: (raw.previewImageUrl as string | null) ?? null,
      previewInsideItems: normalizePreviewInsideItems(raw.cabinetPreviewInside),
      previewAfterEnrollment: (raw.cabinetPreviewAfterEnrollment as string | null) ?? null,
      previewAudience: (raw.cabinetPreviewAudience as string | null) ?? null,
      curatorName: (raw.curatorName as string | null) ?? null,
      curatorTelegramId:
        typeof raw.curatorTelegramId === 'number' && Number.isFinite(raw.curatorTelegramId)
          ? (raw.curatorTelegramId as number)
          : null,
      moduleCount:
        typeof raw.moduleCount === 'number' && Number.isFinite(raw.moduleCount)
          ? Math.max(0, Math.floor(raw.moduleCount as number))
          : 0,
      totalLessons:
        typeof raw.totalLessons === 'number' && Number.isFinite(raw.totalLessons)
          ? Math.max(0, Math.floor(raw.totalLessons as number))
          : 0,
      // Детали модулей — у активного курса через getDistrictCourseContent.
      modulePreviews: [],
    });
  }
  return out;
});

/** Курсы с ценой и числом занятий — карточки оплаты в кабинете. */
export const listCoursePaymentOffers = cache(async function listCoursePaymentOffers(
  options: FetchOptions = {},
): Promise<CoursePaymentOffer[]> {
  const client = getClient(options);
  const rows = await client.fetch<
    {
      sanityId?: string;
      slug?: string;
      title?: string;
      description?: string | null;
      pricing?: { priceByn?: number; grantedLessons?: number; cardText?: string | null } | null;
      priceByn?: number;
      grantedLessons?: number;
    }[]
  >(COURSE_OFFERS_QUERY, {}, getSanityFetchOptions(options));

  const out: CoursePaymentOffer[] = [];
  for (const row of rows ?? []) {
    if (!row?.sanityId || !row.slug || !row.title) continue;
    const pricing = resolveCoursePricing(row);
    if (pricing.priceByn == null || pricing.priceByn < 0) continue;
    if (pricing.grantedLessons == null || pricing.grantedLessons < 1) continue;
    out.push({
      sanityId: row.sanityId,
      slug: row.slug,
      title: row.title,
      description: row.description ?? null,
      cardText: pricing.cardText,
      priceByn: pricing.priceByn,
      grantedLessons: pricing.grantedLessons,
    });
  }
  return out;
});

export async function getCoursePaymentOfferBySlug(
  slug: string,
  options: FetchOptions = {},
): Promise<CoursePaymentOffer | null> {
  const offers = await listCoursePaymentOffers(options);
  return offers.find((o) => o.slug === slug) ?? null;
}

/** Плоский список уроков в порядке модулей. */
export function flattenCourseLessons(content: DistrictCourseContent): CourseLessonContent[] {
  const out: CourseLessonContent[] = [];
  for (const mod of content.modules) {
    out.push(...mod.lessons);
  }
  return out;
}

export function countPublishedLessons(content: DistrictCourseContent): number {
  return flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published').length;
}

/** Все занятия курса (для отображения в кабинете). */
export function countCourseLessons(content: DistrictCourseContent): number {
  return flattenCourseLessons(content).filter((l) => l.publicationStatus !== 'archived').length;
}

export function isLessonVisible(
  lesson: CourseLessonContent,
  progressSanityIds: Set<string>,
): boolean {
  if (lesson.publicationStatus === 'published') return true;
  if (lesson.publicationStatus === 'archived' && progressSanityIds.has(lesson.sanityId)) return true;
  return false;
}

export function mapLessonKind(lessonType: SanityLessonType): 'webinar' | 'practice' | 'milestone' {
  if (lessonType === 'assignment') return 'milestone';
  if (lessonType === 'test') return 'practice';
  return lessonType;
}

export function deriveWebinarSessionStatus(
  lesson: Pick<CourseLessonContent, 'scheduledAt' | 'liveUrl' | 'recordingUrl'>,
): 'scheduled' | 'live' | 'completed' | null {
  if (lesson.recordingUrl) return 'completed';
  if (!lesson.scheduledAt) return null;
  const start = new Date(lesson.scheduledAt).getTime();
  if (Number.isNaN(start)) return null;
  if (start > Date.now()) return 'scheduled';
  if (lesson.liveUrl) return 'live';
  return 'completed';
}

export function resolveLessonActionUrl(lesson: CourseLessonContent): string | null {
  if (lesson.recordingUrl) return lesson.recordingUrl;
  if (lesson.liveUrl) return lesson.liveUrl;
  if (lesson.homework?.url) return lesson.homework.url;
  const materialLink = lesson.materials.find((m) => m.url)?.url;
  return materialLink ?? null;
}

export function resolveLessonActionLabel(lesson: CourseLessonContent): string {
  if (lesson.recordingUrl) return 'Смотреть запись';
  if (lesson.lessonType === 'webinar' && lesson.liveUrl) return 'Смотреть трансляцию';
  return 'Открыть занятие';
}
