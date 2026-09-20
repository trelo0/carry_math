import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import { DISTRICT_COURSE_SLUG } from '@/lib/studio/courseContent';

/** Создаёт или обновляет строку courses в Supabase, связанную с Sanity. Без seed уроков. */
export async function ensureDistrictCourseRecord(
  admin: SupabaseClient,
  content: DistrictCourseContent | null,
): Promise<number | null> {
  const slug = content?.slug ?? DISTRICT_COURSE_SLUG;
  const title = content?.title ?? 'Курс District';
  const description =
    content?.description ??
    'Полная подготовка к ЦТ по математике: от диагностики до пробного экзамена.';
  const sanityId = content?.sanityId ?? null;
  const now = new Date().toISOString();

  const { data: bySanity } = sanityId
    ? await admin.from('courses').select('id').eq('sanity_id', sanityId).maybeSingle()
    : { data: null };

  const { data: bySlug } = await admin
    .from('courses')
    .select('id, sanity_id')
    .eq('slug', slug)
    .maybeSingle();

  const existingId = (bySanity?.id ?? bySlug?.id) as number | undefined;

  if (existingId) {
    const { error } = await admin
      .from('courses')
      .update({
        title,
        slug,
        description,
        sanity_id: sanityId ?? bySlug?.sanity_id ?? null,
        is_active: content?.publicationStatus !== 'archived',
        updated_at: now,
      })
      .eq('id', existingId);
    if (error) throw error;
    return existingId;
  }

  const { data: inserted, error: insertError } = await admin
    .from('courses')
    .insert({
      title,
      slug,
      description,
      sanity_id: sanityId,
      is_active: content?.publicationStatus !== 'archived',
      updated_at: now,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return inserted.id as number;
}

export async function resolveCourseIdForContent(
  admin: SupabaseClient,
  content: DistrictCourseContent | null,
): Promise<number | null> {
  try {
    return await ensureDistrictCourseRecord(admin, content);
  } catch {
    const { data } = await admin
      .from('courses')
      .select('id')
      .eq('slug', DISTRICT_COURSE_SLUG)
      .maybeSingle();
    return (data?.id as number) ?? null;
  }
}
