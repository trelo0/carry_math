import type { SupabaseClient } from '@supabase/supabase-js';
import type { CabinetLessonFileKind } from '@/lib/cabinet-lesson-files';
import { isExternalFileUrl } from '@/lib/cabinet-lesson-files';

export async function resolveLessonFileDownloadUrl(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    lessonId: number;
    fileId: number;
    kind: CabinetLessonFileKind;
  },
): Promise<string | null> {
  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id')
    .eq('id', params.lessonId)
    .eq('telegram_id', params.telegramId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson) return null;

  let storagePath: string | null = null;

  if (params.kind === 'homework') {
    const { data, error } = await admin
      .from('homework_assignments')
      .select('storage_path')
      .eq('id', params.fileId)
      .eq('lesson_id', params.lessonId)
      .maybeSingle();
    if (error) throw error;
    storagePath = (data?.storage_path as string | undefined) ?? null;
  } else {
    const { data, error } = await admin
      .from('lesson_materials')
      .select('storage_path')
      .eq('id', params.fileId)
      .eq('lesson_id', params.lessonId)
      .maybeSingle();
    if (error) throw error;
    storagePath = (data?.storage_path as string | undefined) ?? null;
  }

  if (!storagePath) return null;
  if (isExternalFileUrl(storagePath)) return storagePath;

  const bucket = process.env.CABINET_FILES_BUCKET ?? 'cabinet-files';
  const { data: signed, error: signError } = await admin.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);
  if (signError) throw signError;
  return signed?.signedUrl ?? null;
}
