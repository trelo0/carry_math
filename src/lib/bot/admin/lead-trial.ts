import type { SupabaseClient } from '@supabase/supabase-js';
import { getCabinetPricing, priceForTeacher } from '@/lib/studio/cabinetSettings';
import { validateLessonSlot, ScheduleValidationError } from '@/lib/teacher/schedule-validation';
import { cancelScheduledLesson } from '@/lib/bot/lessons';
import { logLeadEvent } from './lead-events';
import type { LeadRow } from './leads';

export type TrialPaymentStatus = 'not_requested' | 'pending' | 'paid' | 'skipped' | 'failed';

export type LeadTrialLessonRow = {
  id: number;
  lead_id: string | null;
  telegram_id: number;
  teacher_telegram_id: number | null;
  starts_at: string;
  duration_minutes: number;
  topic: string;
  status: string;
  trial_price_byn: number | null;
  trial_payment_status: TrialPaymentStatus;
};

export function isLeadTrialSchemaError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return (
    message.includes('lead_id') ||
    message.includes('trial_payment_status') ||
    message.includes('trial_price_byn') ||
    (message.includes('kind') && message.includes('scheduled_lessons'))
  );
}

export async function getActiveTrialForLead(
  admin: SupabaseClient,
  leadId: string,
): Promise<LeadTrialLessonRow | null> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(
      'id, lead_id, telegram_id, teacher_telegram_id, starts_at, duration_minutes, topic, status, trial_price_byn, trial_payment_status',
    )
    .eq('lead_id', leadId)
    .eq('kind', 'trial')
    .in('status', ['scheduled', 'completed'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isLeadTrialSchemaError(error)) return null;
    throw error;
  }
  return data as LeadTrialLessonRow | null;
}

export async function resolveTrialPriceByn(teacherId: string | null): Promise<number> {
  const pricing = await getCabinetPricing();
  const pack = pricing.individual.options[0];
  if (teacherId && pack) {
    const p = priceForTeacher(pack, teacherId, pricing.teachers);
    if (p != null && p > 0) return p;
  }
  const env = Number(process.env.TRIAL_LESSON_PRICE_BYN ?? '15');
  return Number.isFinite(env) && env > 0 ? env : 15;
}

export async function createTrialLessonForLead(
  admin: SupabaseClient,
  input: {
    lead: LeadRow;
    clientTelegramId: number;
    teacherTelegramId: number;
    teacherId: string | null;
    startsAt: string;
    topic: string;
    durationMinutes?: number;
    actorTelegramId: number;
  },
): Promise<{ lessonId: number; priceByn: number }> {
  const durationMinutes = input.durationMinutes ?? 60;
  try {
    await validateLessonSlot(admin, input.teacherTelegramId, {
      startsAt: input.startsAt,
      durationMinutes,
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      throw error;
    }
    throw error;
  }

  const priceByn = await resolveTrialPriceByn(input.teacherId);
  const { data, error } = await admin
    .from('scheduled_lessons')
    .insert({
      telegram_id: input.clientTelegramId,
      kind: 'trial',
      lead_id: input.lead.id,
      package_id: null,
      teacher_telegram_id: input.teacherTelegramId,
      starts_at: input.startsAt,
      duration_minutes: durationMinutes,
      topic: input.topic,
      status: 'scheduled',
      is_paid: false,
      trial_price_byn: priceByn,
      trial_payment_status: 'not_requested',
    })
    .select('id')
    .single();
  if (error) throw error;

  const lessonId = data.id as number;
  await logLeadEvent(admin, {
    leadId: input.lead.id,
    eventType: 'trial_scheduled',
    actorTelegramId: input.actorTelegramId,
    detail: { lesson_id: lessonId, starts_at: input.startsAt, price_byn: priceByn },
  });

  return { lessonId, priceByn };
}

export async function rescheduleTrialLesson(
  admin: SupabaseClient,
  lessonId: number,
  startsAt: string,
  actorTelegramId: number,
): Promise<void> {
  const { data: lesson, error: loadError } = await admin
    .from('scheduled_lessons')
    .select('id, lead_id, teacher_telegram_id, duration_minutes, status, kind')
    .eq('id', lessonId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!lesson || lesson.kind !== 'trial' || lesson.status !== 'scheduled') {
    throw new Error('Пробное не найдено или уже не scheduled');
  }
  const teacherTelegramId = lesson.teacher_telegram_id as number | null;
  if (!teacherTelegramId) throw new Error('Нет преподавателя');
  await validateLessonSlot(admin, teacherTelegramId, {
    startsAt,
    durationMinutes: (lesson.duration_minutes as number) ?? 60,
    excludeLessonId: lessonId,
  });
  const { error } = await admin
    .from('scheduled_lessons')
    .update({ starts_at: startsAt, updated_at: new Date().toISOString() })
    .eq('id', lessonId)
    .eq('status', 'scheduled');
  if (error) throw error;
  const leadId = lesson.lead_id as string | null;
  if (leadId) {
    await logLeadEvent(admin, {
      leadId,
      eventType: 'trial_rescheduled',
      actorTelegramId,
      detail: { lesson_id: lessonId, starts_at: startsAt },
    });
  }
}

export async function cancelTrialLessonForLead(
  admin: SupabaseClient,
  lessonId: number,
  actorTelegramId: number,
): Promise<boolean> {
  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('lead_id')
    .eq('id', lessonId)
    .maybeSingle();
  const ok = await cancelScheduledLesson(admin, lessonId);
  if (ok && lesson?.lead_id) {
    await logLeadEvent(admin, {
      leadId: lesson.lead_id as string,
      eventType: 'trial_cancelled',
      actorTelegramId,
      detail: { lesson_id: lessonId },
    });
  }
  return ok;
}

/** После окончания слота — completed без списания пакета. */
export async function syncTrialLessonConducted(
  admin: SupabaseClient,
  lesson: LeadTrialLessonRow,
): Promise<boolean> {
  if (lesson.status !== 'scheduled') return false;
  const endMs =
    new Date(lesson.starts_at).getTime() + (lesson.duration_minutes ?? 60) * 60_000;
  if (Date.now() < endMs) return false;
  const now = new Date().toISOString();
  await admin
    .from('scheduled_lessons')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', lesson.id)
    .eq('status', 'scheduled');
  if (lesson.lead_id) {
    await logLeadEvent(admin, {
      leadId: lesson.lead_id,
      eventType: 'trial_conducted',
      detail: { lesson_id: lesson.id },
    });
  }
  return true;
}

export function trialPrefillFromLead(lead: LeadRow): {
  subject: string;
  teacherName: string | null;
} {
  return {
    subject: lead.service?.trim() || 'Математика',
    teacherName: lead.teacher?.trim() || null,
  };
}
