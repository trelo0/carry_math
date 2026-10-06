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

export async function getHomeworkById(
  admin: SupabaseClient,
  homeworkId: number,
): Promise<LessonHomeworkRow | null> {
  const { data, error } = await admin
    .from('homework_assignments')
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .eq('id', homeworkId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
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

  if (homework.reviewStatus === 'revision') {
    await archiveHomeworkSubmissionVersion(admin, homework.id, homework, 'resubmit', null, null, null);
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

export type HomeworkReviewerRole = 'teacher' | 'admin' | 'curator';

function isVersionsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('homework_submission_versions');
}

async function nextHomeworkVersionNo(admin: SupabaseClient, homeworkId: number): Promise<number> {
  const { count, error } = await admin
    .from('homework_submission_versions')
    .select('id', { count: 'exact', head: true })
    .eq('homework_id', homeworkId);
  if (error) {
    if (isVersionsTableError(error)) return 1;
    throw error;
  }
  return (count ?? 0) + 1;
}

export async function archiveHomeworkSubmissionVersion(
  admin: SupabaseClient,
  homeworkId: number,
  snapshot: Pick<
    LessonHomeworkRow,
    'submissionText' | 'submissionFiles' | 'submittedAt'
  >,
  outcome: 'revision' | 'resubmit' | 'approved',
  reviewerTelegramId: number | null,
  reviewerRole: HomeworkReviewerRole | null,
  reviewerComment: string | null,
): Promise<void> {
  if (!snapshot.submittedAt && !snapshot.submissionText?.trim() && snapshot.submissionFiles.length === 0) {
    return;
  }
  const versionNo = await nextHomeworkVersionNo(admin, homeworkId);
  const { error } = await admin.from('homework_submission_versions').insert({
    homework_id: homeworkId,
    version_no: versionNo,
    submission_text: snapshot.submissionText,
    submission_files: snapshot.submissionFiles,
    submitted_at: snapshot.submittedAt,
    outcome,
    reviewer_telegram_id: reviewerTelegramId,
    reviewer_role: reviewerRole,
    reviewer_comment: reviewerComment,
  });
  if (error && !isVersionsTableError(error)) throw error;
}

export type HomeworkSubmissionVersionRow = {
  versionNo: number;
  outcome: string;
  submittedAt: string | null;
  reviewerComment: string | null;
  createdAt: string;
};

export async function listHomeworkSubmissionVersions(
  admin: SupabaseClient,
  homeworkId: number,
): Promise<HomeworkSubmissionVersionRow[]> {
  const { data, error } = await admin
    .from('homework_submission_versions')
    .select('version_no, outcome, submitted_at, reviewer_comment, created_at')
    .eq('homework_id', homeworkId)
    .order('version_no', { ascending: true });
  if (error) {
    if (isVersionsTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    versionNo: row.version_no as number,
    outcome: row.outcome as string,
    submittedAt: (row.submitted_at as string | null) ?? null,
    reviewerComment: (row.reviewer_comment as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function reviewHomeworkAsStaff(
  admin: SupabaseClient,
  homeworkId: number,
  reviewerTelegramId: number,
  reviewerRole: HomeworkReviewerRole,
  input: { action: 'approve' | 'revision'; comment?: string },
): Promise<LessonHomeworkRow> {
  const homework = await getHomeworkById(admin, homeworkId);
  if (!homework) throw new Error('Домашнее задание не найдено');
  if (homework.reviewStatus !== 'submitted' && homework.reviewStatus !== 'reviewing') {
    throw new Error('Нет работы на проверке');
  }
  if (input.action === 'revision' && !input.comment?.trim()) {
    throw new Error('Комментарий обязателен при возврате на доработку');
  }

  const { data: lessonRow, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id, telegram_id, topic, teacher_telegram_id')
    .eq('id', homework.lessonId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lessonRow?.telegram_id) throw new Error('Занятие не найдено');

  if (input.action === 'revision') {
    await archiveHomeworkSubmissionVersion(
      admin,
      homework.id,
      homework,
      'revision',
      reviewerTelegramId,
      reviewerRole,
      input.comment?.trim() ?? null,
    );
  } else {
    await archiveHomeworkSubmissionVersion(
      admin,
      homework.id,
      homework,
      'approved',
      reviewerTelegramId,
      reviewerRole,
      input.comment?.trim() ?? null,
    );
  }

  const now = new Date().toISOString();
  const nextStatus: LessonHomeworkReviewStatus =
    input.action === 'approve' ? 'done' : 'revision';

  const updatePayload: Record<string, unknown> = {
    review_status: nextStatus,
    teacher_comment: input.comment?.trim() || null,
    updated_at: now,
    reviewed_by_telegram_id: reviewerTelegramId,
    reviewed_at: now,
    reviewer_role: reviewerRole,
  };

  const { data, error } = await admin
    .from('homework_assignments')
    .update(updatePayload)
    .eq('id', homework.id)
    .select(
      'id, lesson_id, file_name, file_size, storage_path, instruction_text, due_at, review_status, teacher_comment, submission_text, submission_files, submitted_at',
    )
    .single();
  if (error) throw error;

  const row = mapRow(data as Record<string, unknown>);
  const { notifyStudentLessonHomeworkReviewed } = await import('./bot/lesson-homework-notify');
  await notifyStudentLessonHomeworkReviewed(admin, lessonRow.telegram_id as number, {
    lessonId: homework.lessonId,
    topic: lessonRow.topic as string,
    approved: input.action === 'approve',
    comment: input.comment?.trim(),
  });

  try {
    const { logAdminAction } = await import('./bot/admin/action-log');
    await logAdminAction(admin, {
      actorTelegramId: reviewerTelegramId,
      action: input.action === 'approve' ? 'homework.approve' : 'homework.revision',
      entityType: 'homework',
      entityId: homeworkId,
      detail: { lessonId: homework.lessonId, reviewerRole },
    });
  } catch {
    /* journal optional */
  }

  return row;
}

export async function reviewLessonHomework(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  input: { action: 'approve' | 'revision'; comment?: string },
): Promise<LessonHomeworkRow> {
  await assertTeacherOwnsLesson(admin, teacherTelegramId, lessonId);
  const homework = await getLessonHomework(admin, lessonId);
  if (!homework) throw new Error('Домашнее задание не найдено');
  return reviewHomeworkAsStaff(admin, homework.id, teacherTelegramId, 'teacher', input);
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
