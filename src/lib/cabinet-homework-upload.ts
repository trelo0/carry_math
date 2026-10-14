import type { SupabaseClient } from '@supabase/supabase-js';

const bucket = () => process.env.CABINET_FILES_BUCKET ?? 'cabinet-files';

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, '_').slice(0, 120);
}

export async function uploadStudentHomeworkFile(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  file: File,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `homework/${telegramId}/${sanityLessonId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage.from(bucket()).upload(storagePath, buffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: signed, error: signError } = await admin.storage
    .from(bucket())
    .createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  if (signError) throw signError;
  if (!signed?.signedUrl) throw new Error('Не удалось получить ссылку на файл');
  return signed.signedUrl;
}
