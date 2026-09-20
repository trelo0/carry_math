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
  previewInsideItems: string[];
  previewAfterEnrollment: string | null;
  previewAudience: string | null;
  publicationStatus: SanityPublicationStatus;
  curatorName: string | null;
  modules: CourseModuleContent[];
};

type FetchOptions = { preview?: boolean };

function getClient({ preview }: FetchOptions = {}) {
  return getSanityClient({ preview, includeDrafts: true });
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
  "lessons": lessons[]->${LESSON_FIELDS}
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
  "coverImageUrl": coverImage.asset->url,
  "previewImageUrl": coalesce(cabinetPreviewImage.asset->url, coverImage.asset->url),
  cabinetPreviewInside,
  cabinetPreviewAfterEnrollment,
  cabinetPreviewAudience,
  "curatorName": curator->name,
  "modulesFromCourse": modules[]->${MODULE_FIELDS},
  "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) ${MODULE_FIELDS}
}`;

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

function parsePublishedLessonFiles(raw: unknown): CourseLessonMaterial[] {
  return ((raw as LessonFileRaw[] | null) ?? [])
    .filter((f) => f?.published && f.fileUrl)
    .map((f) => {
      const fileName = f.fileName ?? 'Файл';
      return {
        title: fileName,
        materialType: 'file' as const,
        url: f.fileUrl!,
        fileName,
        fileSize: formatAssetSize(f.fileSize),
      };
    });
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
    previewInsideItems: ((raw.cabinetPreviewInside as string[] | null) ?? []).filter(Boolean),
    previewAfterEnrollment: (raw.cabinetPreviewAfterEnrollment as string | null) ?? null,
    previewAudience: (raw.cabinetPreviewAudience as string | null) ?? null,
    publicationStatus: (raw.publicationStatus as SanityPublicationStatus) ?? 'draft',
    curatorName: (raw.curatorName as string | null) ?? null,
    modules,
  };
}

/** Контент курса из Sanity для кабинета (без фильтра по статусу — фильтруем в коде). */
export const getDistrictCourseContent = cache(async function getDistrictCourseContent(
  slug = DISTRICT_COURSE_SLUG,
  options: FetchOptions = {},
): Promise<DistrictCourseContent | null> {
  const client = getClient(options);
  const raw = await client.fetch<Record<string, unknown> | null>(
    COURSE_CONTENT_QUERY,
    { slug, docId: DISTRICT_COURSE_DOC_ID },
    getSanityFetchOptions(options),
  );
  return normalizeCourse(raw);
});

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
