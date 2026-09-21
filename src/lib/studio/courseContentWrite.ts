import { createClient, type SanityClient } from 'next-sanity';
import { randomBytes } from 'node:crypto';

export type LessonContentField = 'lessonMaterials' | 'lessonHomeworkFiles';

export type LessonPatchFields = {
  liveUrl?: string | null;
  recordingUrl?: string | null;
  scheduledAt?: string | null;
  lessonDate?: string | null;
};

type LessonFileItem = {
  _type?: string;
  _key?: string;
  published?: boolean;
  file?: { asset?: { _ref?: string } };
};

function sanityKey(): string {
  return randomBytes(8).toString('hex');
}

function getWriteClient(): SanityClient {
  const token = process.env.SANITY_API_WRITE_TOKEN;
  if (!token) {
    throw new Error('SANITY_API_WRITE_TOKEN is not configured');
  }

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
  const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? '2023-03-17';

  return createClient({
    projectId,
    dataset,
    apiVersion,
    token,
    useCdn: false,
  });
}

export function isSanityWriteConfigured(): boolean {
  return Boolean(process.env.SANITY_API_WRITE_TOKEN);
}

export async function patchCourseLesson(
  sanityLessonId: string,
  fields: LessonPatchFields,
): Promise<void> {
  const client = getWriteClient();
  const patch: Record<string, string | null> = {};
  if (fields.liveUrl !== undefined) patch.liveUrl = fields.liveUrl;
  if (fields.recordingUrl !== undefined) patch.recordingUrl = fields.recordingUrl;
  if (fields.scheduledAt !== undefined) patch.scheduledAt = fields.scheduledAt;
  if (fields.lessonDate !== undefined) patch.lessonDate = fields.lessonDate;
  if (Object.keys(patch).length === 0) return;
  await client.patch(sanityLessonId).set(patch).commit();
}

export async function uploadCourseLessonFile(
  sanityLessonId: string,
  field: LessonContentField,
  file: Buffer,
  filename: string,
): Promise<void> {
  const client = getWriteClient();
  const asset = await client.assets.upload('file', file, { filename });
  await client
    .patch(sanityLessonId)
    .setIfMissing({ [field]: [] })
    .insert('after', `${field}[-1]`, [
      {
        _type: 'lessonFile',
        _key: sanityKey(),
        file: { _type: 'file', asset: { _type: 'reference', _ref: asset._id } },
        published: false,
      },
    ])
    .commit();
}

async function readLessonFileItems(
  client: SanityClient,
  sanityLessonId: string,
  field: LessonContentField,
): Promise<LessonFileItem[]> {
  const doc = (await client.getDocument(sanityLessonId)) as Record<string, unknown> | null;
  const items = doc?.[field];
  return Array.isArray(items) ? (items as LessonFileItem[]) : [];
}

export async function setCourseLessonFilePublished(
  sanityLessonId: string,
  field: LessonContentField,
  index: number,
  published: boolean,
): Promise<void> {
  const client = getWriteClient();
  const items = await readLessonFileItems(client, sanityLessonId, field);
  if (index < 0 || index >= items.length) {
    throw new Error('File not found');
  }
  const key = items[index]._key;
  if (key) {
    await client
      .patch(sanityLessonId)
      .set({ [`${field}[_key=="${key}"].published`]: published })
      .commit();
    return;
  }
  const updated = items.map((item, i) => (i === index ? { ...item, published } : item));
  await client.patch(sanityLessonId).set({ [field]: updated }).commit();
}

export async function deleteCourseLessonFile(
  sanityLessonId: string,
  field: LessonContentField,
  index: number,
): Promise<void> {
  const client = getWriteClient();
  const items = await readLessonFileItems(client, sanityLessonId, field);
  if (index < 0 || index >= items.length) {
    throw new Error('File not found');
  }
  const key = items[index]._key;
  if (key) {
    await client.patch(sanityLessonId).unset([`${field}[_key=="${key}"]`]).commit();
    return;
  }
  const updated = items.filter((_, i) => i !== index);
  await client.patch(sanityLessonId).set({ [field]: updated }).commit();
}
