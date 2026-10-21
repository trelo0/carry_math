import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseHomeworkReviewerRole } from './course-progress';

export type CourseHomeworkSubmissionEventType = 'submitted' | 'revision_requested' | 'approved';

export type CourseHomeworkSubmissionEvent = {
  id: number;
  sequenceNo: number;
  eventType: CourseHomeworkSubmissionEventType;
  submissionNote: string | null;
  submissionFileUrl: string | null;
  reviewerTelegramId: number | null;
  reviewerRole: string | null;
  reviewerComment: string | null;
  createdAt: string;
};

function isEventsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('course_homework_submission_events');
}

async function nextSequenceNo(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('course_homework_submission_events')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId);
  if (error) {
    if (isEventsTableError(error)) return 1;
    throw error;
  }
  return (count ?? 0) + 1;
}

async function insertEvent(
  admin: SupabaseClient,
  row: {
    telegramId: number;
    sanityLessonId: string;
    courseId?: number | null;
    eventType: CourseHomeworkSubmissionEventType;
    submissionNote?: string | null;
    submissionFileUrl?: string | null;
    reviewerTelegramId?: number | null;
    reviewerRole?: CourseHomeworkReviewerRole | string | null;
    reviewerComment?: string | null;
    createdAt?: string;
  },
): Promise<void> {
  const sequenceNo = await nextSequenceNo(admin, row.telegramId, row.sanityLessonId);
  const payload: Record<string, unknown> = {
    telegram_id: row.telegramId,
    sanity_lesson_id: row.sanityLessonId,
    course_id: row.courseId ?? null,
    event_type: row.eventType,
    sequence_no: sequenceNo,
    submission_note: row.submissionNote?.trim() || null,
    submission_file_url: row.submissionFileUrl?.trim() || null,
    reviewer_telegram_id: row.reviewerTelegramId ?? null,
    reviewer_role: row.reviewerRole ?? null,
    reviewer_comment: row.reviewerComment?.trim() || null,
  };
  if (row.createdAt) payload.created_at = row.createdAt;

  const { error } = await admin.from('course_homework_submission_events').insert(payload);
  if (error && !isEventsTableError(error)) throw error;
}

export async function logCourseHomeworkSubmitted(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    sanityLessonId: string;
    courseId?: number | null;
    note?: string | null;
    fileUrl?: string | null;
    submittedAt?: string;
  },
): Promise<void> {
  await insertEvent(admin, {
    telegramId: params.telegramId,
    sanityLessonId: params.sanityLessonId,
    courseId: params.courseId,
    eventType: 'submitted',
    submissionNote: params.note,
    submissionFileUrl: params.fileUrl,
    createdAt: params.submittedAt,
  });
}

export async function logCourseHomeworkRevisionRequested(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    sanityLessonId: string;
    courseId?: number | null;
    submissionNote?: string | null;
    submissionFileUrl?: string | null;
    reviewerTelegramId: number;
    reviewerRole: CourseHomeworkReviewerRole;
    reviewerComment?: string | null;
    createdAt?: string;
  },
): Promise<void> {
  await insertEvent(admin, {
    telegramId: params.telegramId,
    sanityLessonId: params.sanityLessonId,
    courseId: params.courseId,
    eventType: 'revision_requested',
    submissionNote: params.submissionNote,
    submissionFileUrl: params.submissionFileUrl,
    reviewerTelegramId: params.reviewerTelegramId,
    reviewerRole: params.reviewerRole,
    reviewerComment: params.reviewerComment,
    createdAt: params.createdAt,
  });
}

export async function logCourseHomeworkApproved(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    sanityLessonId: string;
    courseId?: number | null;
    submissionNote?: string | null;
    submissionFileUrl?: string | null;
    reviewerTelegramId: number;
    reviewerRole: CourseHomeworkReviewerRole;
    reviewerComment?: string | null;
    createdAt?: string;
  },
): Promise<void> {
  await insertEvent(admin, {
    telegramId: params.telegramId,
    sanityLessonId: params.sanityLessonId,
    courseId: params.courseId,
    eventType: 'approved',
    submissionNote: params.submissionNote,
    submissionFileUrl: params.submissionFileUrl,
    reviewerTelegramId: params.reviewerTelegramId,
    reviewerRole: params.reviewerRole,
    reviewerComment: params.reviewerComment,
    createdAt: params.createdAt,
  });
}

function mapRow(row: Record<string, unknown>): CourseHomeworkSubmissionEvent {
  return {
    id: row.id as number,
    sequenceNo: row.sequence_no as number,
    eventType: row.event_type as CourseHomeworkSubmissionEventType,
    submissionNote: (row.submission_note as string | null) ?? null,
    submissionFileUrl: (row.submission_file_url as string | null) ?? null,
    reviewerTelegramId: (row.reviewer_telegram_id as number | null) ?? null,
    reviewerRole: (row.reviewer_role as string | null) ?? null,
    reviewerComment: (row.reviewer_comment as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Однократная реконструкция из progress, если событий ещё нет. */
async function backfillEventsFromProgress(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'homework_status, homework_submitted_at, submission_note, submission_file_url, review_note, reviewed_at, reviewed_by_telegram_id, reviewer_role, updated_at',
    )
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error || !data) return;

  const status = String(data.homework_status ?? 'pending');
  const submittedAt =
    (data.homework_submitted_at as string | null) ??
    (status !== 'pending' ? (data.updated_at as string | null) : null);
  if (!submittedAt && status === 'pending') return;

  if (submittedAt) {
    await logCourseHomeworkSubmitted(admin, {
      telegramId,
      sanityLessonId,
      note: data.submission_note as string | null,
      fileUrl: data.submission_file_url as string | null,
      submittedAt,
    });
  }

  if (status === 'rejected' || status === 'approved') {
    const reviewedAt = (data.reviewed_at as string | null) ?? (data.updated_at as string);
    const reviewerId = data.reviewed_by_telegram_id as number | null;
    const reviewerRole = (data.reviewer_role as CourseHomeworkReviewerRole | null) ?? 'check';
    if (status === 'rejected' && reviewerId != null) {
      await logCourseHomeworkRevisionRequested(admin, {
        telegramId,
        sanityLessonId,
        submissionNote: data.submission_note as string | null,
        submissionFileUrl: data.submission_file_url as string | null,
        reviewerTelegramId: reviewerId,
        reviewerRole,
        reviewerComment: data.review_note as string | null,
        createdAt: reviewedAt,
      });
    }
    if (status === 'approved' && reviewerId != null) {
      await logCourseHomeworkApproved(admin, {
        telegramId,
        sanityLessonId,
        submissionNote: data.submission_note as string | null,
        submissionFileUrl: data.submission_file_url as string | null,
        reviewerTelegramId: reviewerId,
        reviewerRole,
        reviewerComment: data.review_note as string | null,
        createdAt: reviewedAt,
      });
    }
  }
}

export async function listCourseHomeworkSubmissionEvents(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  options?: { backfill?: boolean },
): Promise<CourseHomeworkSubmissionEvent[]> {
  const { data, error } = await admin
    .from('course_homework_submission_events')
    .select(
      'id, sequence_no, event_type, submission_note, submission_file_url, reviewer_telegram_id, reviewer_role, reviewer_comment, created_at',
    )
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .order('sequence_no', { ascending: true });
  if (error) {
    if (isEventsTableError(error)) return [];
    throw error;
  }
  let rows = (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
  if (rows.length === 0 && options?.backfill !== false) {
    await backfillEventsFromProgress(admin, telegramId, sanityLessonId);
    const retry = await admin
      .from('course_homework_submission_events')
      .select(
        'id, sequence_no, event_type, submission_note, submission_file_url, reviewer_telegram_id, reviewer_role, reviewer_comment, created_at',
      )
      .eq('telegram_id', telegramId)
      .eq('sanity_lesson_id', sanityLessonId)
      .order('sequence_no', { ascending: true });
    if (!retry.error) {
      rows = (retry.data ?? []).map((r) => mapRow(r as Record<string, unknown>));
    }
  }
  return rows;
}

export function formatCourseHomeworkSubmissionTimeline(
  events: CourseHomeworkSubmissionEvent[],
  formatWhen: (iso: string) => string,
): string[] {
  if (events.length === 0) return [];
  const lines = ['', '📜 История проверок:', ''];
  let submitIndex = 0;
  for (const ev of events) {
    const when = formatWhen(ev.createdAt);
    if (ev.eventType === 'submitted') {
      submitIndex += 1;
      lines.push(`• ${when} — ${submitIndex}-я сдача`);
      continue;
    }
    if (ev.eventType === 'revision_requested') {
      lines.push(`• ${when} — на доработке`);
      continue;
    }
    if (ev.eventType === 'approved') {
      lines.push(`• ${when} — одобрено`);
    }
  }
  return lines;
}

export function buildCheckHomeworkHistoryButtons(
  events: CourseHomeworkSubmissionEvent[],
  formatWhen: (iso: string) => string,
  callbackForSeq: (sequenceNo: number) => string,
): { label: string; callbackData: string }[] {
  const submits = events.filter((e) => e.eventType === 'submitted');
  return submits.map((ev, idx) => {
    const tail = events.filter(
      (e) => e.sequenceNo > ev.sequenceNo && e.eventType !== 'submitted',
    )[0];
    const status =
      tail?.eventType === 'approved'
        ? 'одобрено'
        : tail?.eventType === 'revision_requested'
          ? 'на доработке'
          : 'на проверке';
    return {
      label: `${idx + 1} сдача · ${status} · ${formatWhen(ev.createdAt)}`,
      callbackData: callbackForSeq(ev.sequenceNo),
    };
  });
}

export function summarizeSubmissionAttempt(
  events: CourseHomeworkSubmissionEvent[],
  sequenceNo: number,
  formatWhen: (iso: string) => string,
): string[] {
  const submit = events.find((e) => e.sequenceNo === sequenceNo && e.eventType === 'submitted');
  if (!submit) return ['Запись не найдена.'];
  const after = events.filter((e) => e.sequenceNo > sequenceNo);
  const verdict = after.find((e) => e.eventType !== 'submitted');
  const lines = [`🕐 ${formatWhen(submit.createdAt)}`, `Статус: ${verdict?.eventType === 'approved' ? 'одобрено' : verdict?.eventType === 'revision_requested' ? 'на доработке' : 'на проверке'}`];
  if (submit.submissionNote?.trim()) {
    lines.push('', '💬 Комментарий ученика:', submit.submissionNote.trim());
  }
  if (verdict?.reviewerComment?.trim()) {
    lines.push('', '✏️ Комментарий проверяющего:', verdict.reviewerComment.trim());
  }
  return lines;
}
