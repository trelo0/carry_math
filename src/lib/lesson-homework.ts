import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalFileUrl } from '@/lib/cabinet-lesson-files';

export type LessonHomeworkReviewStatus =
  | 'pending'
  | 'submitted'
  | 'reviewing'
  | 'done'
  | 'revision';

export type LessonHomeworkSubmissionFile = {
  ref: string;
  kind: 'photo' | 'document';
  name?: string;
};

export type LessonHomeworkRow = {
  id: number;
  lessonId: number;
  fileName: string;
  fileSize: string | null;
  storagePath: string;
  instructionText: string | null;
  dueAt: string | null;
  reviewStatus: LessonHomeworkReviewStatus;
  teacherComment: string | null;
  submissionText: string | null;
  submissionFiles: LessonHomeworkSubmissionFile[];
  submittedAt: string | null;
};

const bucket = () => process.env.CABINET_FILES_BUCKET ?? 'cabinet-files';

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, '_').slice(0, 120);
}

function mapRow(row: Record<string, unknown>): LessonHomeworkRow {
  const rawFiles = row.submission_files;
  let submissionFiles: LessonHomeworkSubmissionFile[] = [];
  if (Array.isArray(rawFiles)) {
    submissionFiles = rawFiles as LessonHomeworkSubmissionFile[];
  }

  return {
    id: row.id as number,
    lessonId: row.lesson_id as number,
    fileName: row.file_name as string,
    fileSize: (row.file_size as string | null) ?? null,
    storagePath: row.storage_path as string,
    instructionText: (row.instruction_text as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    reviewStatus: row.review_status as LessonHomeworkReviewStatus,
    teacherComment: (row.teacher_comment as string | null) ?? null,
    submissionText: (row.submission_text as string | null) ?? null,
    submissionFiles,
    submittedAt: (row.submitted_at as string | null) ?? null,
  };
}

async function assertTeacherOwnsLesson(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
): Promise<{ telegramId: number; startsAt: string; topic: string }> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select('id, telegram_id, starts_at, topic, teacher_telegram_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.teacher_telegram_id !== teacherTelegramId) {
    throw new Error('Lesson not found');
  }
  return {
    telegramId: data.telegram_id as number,
    startsAt: data.starts_at as string,
    topic: data.topic as string,
  };
}

export async function getLessonHomework(
  admin: SupabaseClient,
  lessonId: number,
): Promise<LessonHomeworkRow | null> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function getLessonHomeworkForStudent(
  admin: SupabaseClient,
  telegramId: number,
  lessonId: number,
): Promise<LessonHomeworkRow | null> {
  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id')
    .eq('id', lessonId)
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson) return null;
  return getLessonHomework(admin, lessonId);
}

export async function upsertTeacherLessonHomework(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  input: {
    file?: File;
    instructionText?: string;
    dueAt?: string | null;
  },
): Promise<LessonHomeworkRow> {
  const lesson = await assertTeacherOwnsLesson(admin, teacherTelegramId, lessonId);

  let storagePath = '';
  let fileName = 'Домашнее задание';
  let fileSize: string | null = null;

  if (input.file) {
    const buffer = Buffer.from(await input.file.arrayBuffer());
    storagePath = `scheduled-lessons/${lessonId}/homework-${Date.now()}-${safeFileName(input.file.name)}`;
    const { error: uploadError } = await admin.storage.from(bucket()).upload(storagePath, buffer, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: true,
    });
    if (uploadError) throw uploadError;
    fileName = input.file.name;
    fileSize = input.file.size ? String(input.file.size) : null;
  } else {
    const existing = await getLessonHomework(admin, lessonId);
    if (!existing) {
      throw new Error('Нужен файл задания или существующее домашнее задание');
    }
    storagePath = existing.storagePath;
    fileName = existing.fileName;
    fileSize = existing.fileSize;
  }

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    lesson_id: lessonId,
    file_name: fileName,
    file_size: fileSize,
    storage_path: storagePath,
    instruction_text: input.instructionText?.trim() || null,
    due_at: input.dueAt?.trim() || null,
    updated_at: now,
  };

  const existing = await getLessonHomework(admin, lessonId);
  const notifyStudent = !existing || Boolean(input.file);

  if (existing) {
    const { data, error } = await admin
      .from('homework_assignments')
      .update(payload)
      .eq('id', existing.id)
      .select(
        'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
      )
      .single();
    if (error) throw error;
    const row = mapRow(data as Record<string, unknown>);
    if (notifyStudent) {
      const { notifyStudentLessonHomeworkAssigned } = await import('./bot/lesson-homework-notify');
      await notifyStudentLessonHomeworkAssigned(admin, lesson.telegramId, {
        lessonId,
        topic: lesson.topic,
        startsAt: lesson.startsAt,
      });
    }
    return row;
  }

  const { data, error } = await admin
    .from('homework_assignments')
    .insert({ ...payload, review_status: 'pending' })
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .single();
  if (error) throw error;
  const row = mapRow(data as Record<string, unknown>);
  const { notifyStudentLessonHomeworkAssigned } = await import('./bot/lesson-homework-notify');
  await notifyStudentLessonHomeworkAssigned(admin, lesson.telegramId, {
    lessonId,
    topic: lesson.topic,
    startsAt: lesson.startsAt,
  });
  return row;
}

export async function submitLessonHomework(
  admin: SupabaseClient,
  telegramId: number,
  lessonId: number,
  input: {
    submissionText?: string;
    submissionFiles: LessonHomeworkSubmissionFile[];
  },
): Promise<LessonHomeworkRow> {
  const homework = await getLessonHomeworkForStudent(admin, telegramId, lessonId);
  if (!homework) throw new Error('Домашнее задание не найдено');
  if (homework.reviewStatus === 'submitted' || homework.reviewStatus === 'reviewing') {
    throw new Error('Работа уже на проверке');
  }
  if (homework.reviewStatus === 'done') {
    throw new Error('Задание уже принято');
  }
  if (!input.submissionText?.trim() && input.submissionFiles.length === 0) {
    throw new Error('Отправьте текст или хотя бы один файл');
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('homework_assignments')
    .update({
      submission_text: input.submissionText?.trim() || null,
      submission_files: input.submissionFiles,
      submitted_at: now,
      review_status: 'submitted',
      updated_at: now,
    })
    .eq('id', homework.id)
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .single();
  if (error) throw error;

  const row = mapRow(data as Record<string, unknown>);
  const { notifyTeacherLessonHomeworkSubmitted } = await import('./bot/lesson-homework-notify');
  await notifyTeacherLessonHomeworkSubmitted(admin, lessonId, telegramId);
  return row;
}

export async function reviewLessonHomework(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  input: { action: 'approve' | 'revision'; comment?: string },
): Promise<LessonHomeworkRow> {
  const lesson = await assertTeacherOwnsLesson(admin, teacherTelegramId, lessonId);
  const homework = await getLessonHomework(admin, lessonId);
  if (!homework) throw new Error('Домашнее задание не найдено');
  if (homework.reviewStatus !== 'submitted' && homework.reviewStatus !== 'reviewing') {
    throw new Error('Нет работы на проверке');
  }

  if (input.action === 'revision' && !input.comment?.trim()) {
    throw new Error('Комментарий обязателен при возврате на доработку');
  }

  const now = new Date().toISOString();
  const nextStatus: LessonHomeworkReviewStatus =
    input.action === 'approve' ? 'done' : 'revision';

  const { data, error } = await admin
    .from('homework_assignments')
    .update({
      review_status: nextStatus,
      teacher_comment: input.comment?.trim() || null,
      updated_at: now,
    })
    .eq('id', homework.id)
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .single();
  if (error) throw error;

  const row = mapRow(data as Record<string, unknown>);
  const { notifyStudentLessonHomeworkReviewed } = await import('./bot/lesson-homework-notify');
  await notifyStudentLessonHomeworkReviewed(admin, lesson.telegramId, {
    lessonId,
    topic: lesson.topic,
    approved: input.action === 'approve',
    comment: input.comment?.trim(),
  });
  return row;
}

export async function resolveHomeworkAssignmentUrl(
  admin: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  if (isExternalFileUrl(storagePath)) return storagePath;
  const { data, error } = await admin.storage.from(bucket()).createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export function canStudentSubmitHomework(status: LessonHomeworkReviewStatus): boolean {
  return status === 'pending' || status === 'revision';
}

export function homeworkReviewStatusLabel(status: LessonHomeworkReviewStatus): string {
  switch (status) {
    case 'pending':
      return 'Не сдано';
    case 'submitted':
      return 'На проверке';
    case 'reviewing':
      return 'На проверке';
    case 'done':
      return 'Принято';
    case 'revision':
      return 'Нужна доработка';
    default:
      return status;
  }
}
