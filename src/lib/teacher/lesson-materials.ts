import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalFileUrl } from '@/lib/cabinet-lesson-files';

export type TeacherLessonMaterialView = {
  id: number;
  fileName: string;
  fileSize: string | null;
};

const bucket = () => process.env.CABINET_FILES_BUCKET ?? 'cabinet-files';

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, '_').slice(0, 120);
}

export async function listTeacherLessonMaterials(
  admin: SupabaseClient,
  lessonId: number,
): Promise<TeacherLessonMaterialView[]> {
  const { data, error } = await admin
    .from('lesson_materials')
    .select('id, file_name, file_size, sort_order')
    .eq('lesson_id', lessonId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as number,
    fileName: row.file_name as string,
    fileSize: (row.file_size as string | null) ?? null,
  }));
}

export async function uploadTeacherLessonMaterial(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  file: File,
): Promise<TeacherLessonMaterialView> {
  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id, teacher_telegram_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson || lesson.teacher_telegram_id !== teacherTelegramId) {
    throw new Error('Lesson not found');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `scheduled-lessons/${lessonId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage.from(bucket()).upload(storagePath, buffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { count, error: countError } = await admin
    .from('lesson_materials')
    .select('id', { count: 'exact', head: true })
    .eq('lesson_id', lessonId);
  if (countError) throw countError;

  const { data: row, error: insertError } = await admin
    .from('lesson_materials')
    .insert({
      lesson_id: lessonId,
      file_name: file.name,
      file_size: file.size ? String(file.size) : null,
      storage_path: storagePath,
      sort_order: count ?? 0,
    })
    .select('id, file_name, file_size')
    .single();
  if (insertError) throw insertError;

  return {
    id: row.id as number,
    fileName: row.file_name as string,
    fileSize: (row.file_size as string | null) ?? null,
  };
}

export async function deleteTeacherLessonMaterial(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  materialId: number,
): Promise<void> {
  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id, teacher_telegram_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson || lesson.teacher_telegram_id !== teacherTelegramId) {
    throw new Error('Lesson not found');
  }

  const { data: material, error: materialError } = await admin
    .from('lesson_materials')
    .select('id, storage_path')
    .eq('id', materialId)
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (materialError) throw materialError;
  if (!material) throw new Error('Material not found');

  const storagePath = material.storage_path as string;
  if (storagePath && !isExternalFileUrl(storagePath)) {
    await admin.storage.from(bucket()).remove([storagePath]);
  }

  const { error: deleteError } = await admin.from('lesson_materials').delete().eq('id', materialId);
  if (deleteError) throw deleteError;
}

export async function resolveTeacherLessonMaterialUrl(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  materialId: number,
): Promise<string | null> {
  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id')
    .eq('id', lessonId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson) return null;

  const { data: material, error: materialError } = await admin
    .from('lesson_materials')
    .select('storage_path')
    .eq('id', materialId)
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (materialError) throw materialError;
  if (!material) return null;

  const storagePath = material.storage_path as string;
  if (isExternalFileUrl(storagePath)) return storagePath;

  const { data: signed, error: signError } = await admin.storage
    .from(bucket())
    .createSignedUrl(storagePath, 60 * 60);
  if (signError) throw signError;
  return signed?.signedUrl ?? null;
}
