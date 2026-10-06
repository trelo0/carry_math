import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminProblem } from './problems-data';

export async function recordPaymentFulfillProblem(
  admin: SupabaseClient,
  input: {
    telegramId?: number;
    externalId?: string;
    code?: string;
    message: string;
    critical?: boolean;
  },
): Promise<void> {
  await createAdminProblem(admin, {
    status: input.critical ? 'critical' : 'attention',
    category: 'finance',
    title: 'Оплата не прошла или не удалось начислить доступ',
    description: input.message.slice(0, 500),
    entityType: 'payment',
    entityId: input.externalId,
    openCallback: 'ah:go:finance:pending',
    dedupeKey: input.externalId ? `payment-fail:${input.externalId}` : undefined,
    detail: {
      telegramId: input.telegramId,
      code: input.code,
    },
  });
}

export async function recordScheduleConflictProblem(
  admin: SupabaseClient,
  input: {
    message: string;
    teacherTelegramId?: number;
    lessonKind?: string;
    dedupeKey?: string;
  },
): Promise<void> {
  await createAdminProblem(admin, {
    status: 'critical',
    category: 'schedule',
    title: 'Конфликт расписания',
    description: input.message.slice(0, 500),
    openCallback: 'ah:go:schedule',
    dedupeKey: input.dedupeKey ?? `schedule-conflict:${input.teacherTelegramId ?? 'x'}:${Date.now() >> 20}`,
    detail: {
      teacherTelegramId: input.teacherTelegramId,
      lessonKind: input.lessonKind,
    },
  });
}

export async function recordTrialPaymentProblem(
  admin: SupabaseClient,
  externalId: string,
  message: string,
): Promise<void> {
  await createAdminProblem(admin, {
    status: 'attention',
    category: 'finance',
    title: 'Проблема с оплатой пробного занятия',
    description: message.slice(0, 500),
    openCallback: 'al:menu',
    dedupeKey: `trial-pay-fail:${externalId}`,
    detail: { externalId },
  });
}
