import type { SupabaseClient } from '@supabase/supabase-js';
import { formatScheduleOverlapDbError, isScheduleOverlapDbError } from '@/lib/teacher/schedule-rpc';

export async function insertIndividualLessonAtomic(
  admin: SupabaseClient,
  params: {
    teacherTelegramId: number;
    startsAt: string;
    durationMinutes: number;
    topic: string;
    participantName: string | null;
    scheduleStudentId: number | null;
    lessonPlan: string | null;
  },
): Promise<{ id: number }> {
  const { data, error } = await admin.rpc('teacher_insert_individual_lesson', {
    p_teacher_id: params.teacherTelegramId,
    p_starts_at: params.startsAt,
    p_duration_minutes: params.durationMinutes,
    p_topic: params.topic,
    p_participant_name: params.participantName,
    p_schedule_student_id: params.scheduleStudentId,
    p_lesson_plan: params.lessonPlan,
  });

  if (error) {
    if (isScheduleOverlapDbError(error) || error.message?.includes('уже назначено')) {
      throw new Error(formatScheduleOverlapDbError());
    }
    if ((error.message ?? '').includes('Could not find the function')) {
      const { data: row, error: insertError } = await admin
        .from('scheduled_lessons')
        .insert({
          telegram_id: null,
          kind: 'individual',
          teacher_telegram_id: params.teacherTelegramId,
          starts_at: params.startsAt,
          duration_minutes: params.durationMinutes,
          topic: params.topic,
          status: 'scheduled',
          package_id: null,
          lesson_plan: params.lessonPlan,
          participant_name: params.participantName,
          schedule_student_id: params.scheduleStudentId,
        })
        .select('id')
        .single();
      if (insertError) {
        if (isScheduleOverlapDbError(insertError)) throw new Error(formatScheduleOverlapDbError());
        throw insertError;
      }
      return { id: row.id as number };
    }
    throw error;
  }

  return { id: data as number };
}
