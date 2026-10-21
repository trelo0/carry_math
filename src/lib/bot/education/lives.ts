import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyLivesExhaustedOnce } from './lives-notify';

export type CourseEnrollmentState = {
  telegram_id: number;
  course_id: number;
  lives_current: number;
  lives_max: number;
  /** Заморозка при 0 жизней; снимается при +жизни / monthly restore. */
  access_blocked: boolean;
  frozen_at: string | null;
  frozen_reason: string | null;
  /** Полная блокировка админом. */
  fully_blocked: boolean;
  fully_blocked_at: string | null;
  fully_blocked_by: number | null;
  fully_blocked_reason: string | null;
  lives_zero_notified_at: string | null;
  updated_at: string;
};

export type LifeOperationType =
  | 'deduct'
  | 'grant'
  | 'monthly_restore'
  | 'correction'
  | 'unfreeze'
  | 'repurchase_reset';

export type CourseLifeEvent = {
  id: number;
  telegram_id: number;
  course_id: number;
  delta: number;
  reason: string;
  curator_telegram_id: number | null;
  course_lesson_id: number | null;
  sanity_lesson_id: string | null;
  lives_before: number | null;
  lives_after: number | null;
  operation_type: LifeOperationType | string | null;
  period_key: string | null;
  created_at: string;
};

export const HOMEWORK_LIFE_REASONS = {
  notSubmitted: 'ДЗ не сдано',
  notCompleted: 'ДЗ не выполнено',
  rejected: 'ДЗ выполнено неправильно',
  overdue: 'ДЗ просрочено',
} as const;

export type HomeworkLifeFailureKind = keyof typeof HOMEWORK_LIFE_REASONS;

export function isLivesTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('course_enrollment_state') ||
    message.includes('course_life_events') ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  );
}

function normalizeState(row: CourseEnrollmentState): CourseEnrollmentState {
  return {
    ...row,
    fully_blocked: Boolean(row.fully_blocked),
    fully_blocked_at: row.fully_blocked_at ?? null,
    fully_blocked_by: row.fully_blocked_by ?? null,
    fully_blocked_reason: row.fully_blocked_reason ?? null,
    lives_zero_notified_at: row.lives_zero_notified_at ?? null,
    access_blocked: Boolean(row.access_blocked),
    frozen_at: row.frozen_at ?? null,
    frozen_reason: row.frozen_reason ?? null,
  };
}

/** Период YYYY-MM в Europe/Moscow. */
export function moscowPeriodKey(date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
  });
  // en-CA → YYYY-MM-DD
  const parts = fmt.formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

/** День месяца 1–31 в Europe/Moscow. */
export function moscowDayOfMonth(date = new Date()): number {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
  }).format(date);
  return Number(day) || 1;
}

/** Сколько enrollment с жизнями ниже max. */
export async function countEnrollmentsBelowMaxLives(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('course_enrollment_state')
    .select('telegram_id, lives_current, lives_max');
  if (error) {
    if (isLivesTableError(error)) return 0;
    throw error;
  }
  return (data ?? []).filter((row) => (row.lives_current as number) < (row.lives_max as number)).length;
}

export type EnrollmentLivesListRow = {
  telegram_id: number;
  course_id: number;
  lives_current: number;
  lives_max: number;
  access_blocked: boolean;
  fully_blocked: boolean;
};

export type LivesHubCounts = {
  zero: number;
  one: number;
  two: number;
  full: number;
  frozen: number;
  fullyBlocked: number;
  belowMax: number;
  total: number;
};

/** Сводка по жизням (опционально по курсу). */
export async function getLivesHubCounts(
  admin: SupabaseClient,
  courseId?: number | null,
): Promise<LivesHubCounts> {
  let query = admin
    .from('course_enrollment_state')
    .select('lives_current, lives_max, access_blocked, fully_blocked');
  if (courseId) query = query.eq('course_id', courseId);
  const { data, error } = await query;
  if (error) {
    if (isLivesTableError(error)) {
      return {
        zero: 0,
        one: 0,
        two: 0,
        full: 0,
        frozen: 0,
        fullyBlocked: 0,
        belowMax: 0,
        total: 0,
      };
    }
    throw error;
  }

  const counts: LivesHubCounts = {
    zero: 0,
    one: 0,
    two: 0,
    full: 0,
    frozen: 0,
    fullyBlocked: 0,
    belowMax: 0,
    total: 0,
  };
  for (const row of data ?? []) {
    counts.total += 1;
    const cur = Number(row.lives_current) || 0;
    const max = Number(row.lives_max) || 3;
    if (cur === 0) counts.zero += 1;
    else if (cur === 1) counts.one += 1;
    else if (cur === 2) counts.two += 1;
    if (cur >= max) counts.full += 1;
    if (cur < max) counts.belowMax += 1;
    if (row.access_blocked) counts.frozen += 1;
    if (row.fully_blocked) counts.fullyBlocked += 1;
  }
  return counts;
}

/** Список учеников с ровно N жизнями. */
export async function listEnrollmentsWithLivesCurrent(
  admin: SupabaseClient,
  livesCurrent: number,
  options?: { courseId?: number | null; limit?: number; offset?: number },
): Promise<EnrollmentLivesListRow[]> {
  const limit = options?.limit ?? 8;
  const offset = options?.offset ?? 0;
  let query = admin
    .from('course_enrollment_state')
    .select('telegram_id, course_id, lives_current, lives_max, access_blocked, fully_blocked')
    .eq('lives_current', livesCurrent)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (options?.courseId) query = query.eq('course_id', options.courseId);
  const { data, error } = await query;
  if (error) {
    if (isLivesTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    telegram_id: row.telegram_id as number,
    course_id: row.course_id as number,
    lives_current: row.lives_current as number,
    lives_max: row.lives_max as number,
    access_blocked: Boolean(row.access_blocked),
    fully_blocked: Boolean(row.fully_blocked),
  }));
}

export type OverdueHomeworkHubRow = {
  telegram_id: number;
  course_id: number | null;
  sanity_lesson_id: string;
  homework_deadline_at: string;
  homework_overdue_at: string | null;
  homework_status: string;
};

function isOverdueHwRow(row: {
  homework_deadline_at: string | null;
  homework_overdue_at: string | null;
}, nowMs = Date.now()): boolean {
  if (row.homework_overdue_at) return true;
  if (!row.homework_deadline_at) return false;
  const t = Date.parse(row.homework_deadline_at);
  return Number.isFinite(t) && t <= nowMs;
}

/** Просроченные ДЗ (pending/rejected, deadline в прошлом или overdue_at). */
export async function listOverdueHomeworkForHub(
  admin: SupabaseClient,
  options?: { limit?: number; offset?: number; courseId?: number | null },
): Promise<OverdueHomeworkHubRow[]> {
  const limit = options?.limit ?? 8;
  const offset = options?.offset ?? 0;
  const nowMs = Date.now();
  // Берём активные дедлайны и фильтруем просрочку в коде (безопаснее, чем ISO в .or()).
  let query = admin
    .from('course_lesson_student_progress')
    .select(
      'telegram_id, course_id, sanity_lesson_id, homework_deadline_at, homework_overdue_at, homework_status',
    )
    .in('homework_status', ['pending', 'rejected'])
    .not('homework_deadline_at', 'is', null)
    .order('homework_deadline_at', { ascending: true })
    .limit(Math.min(400, offset + limit + 50));
  if (options?.courseId != null) query = query.eq('course_id', options.courseId);
  const { data, error } = await query;
  if (error) {
    const message = String((error as { message?: unknown }).message ?? error);
    if (
      message.includes('homework_deadline_at') ||
      message.includes('does not exist') ||
      message.includes('Could not find')
    ) {
      return [];
    }
    throw error;
  }
  return (data ?? [])
    .filter(
      (row) =>
        row.sanity_lesson_id &&
        row.telegram_id &&
        row.homework_deadline_at &&
        isOverdueHwRow(
          {
            homework_deadline_at: row.homework_deadline_at as string | null,
            homework_overdue_at: (row.homework_overdue_at as string | null) ?? null,
          },
          nowMs,
        ),
    )
    .slice(offset, offset + limit)
    .map((row) => ({
      telegram_id: row.telegram_id as number,
      course_id: (row.course_id as number | null) ?? null,
      sanity_lesson_id: row.sanity_lesson_id as string,
      homework_deadline_at: row.homework_deadline_at as string,
      homework_overdue_at: (row.homework_overdue_at as string | null) ?? null,
      homework_status: String(row.homework_status ?? 'pending'),
    }));
}

export async function countOverdueHomeworkForHub(
  admin: SupabaseClient,
  courseId?: number | null,
): Promise<number> {
  const nowMs = Date.now();
  let query = admin
    .from('course_lesson_student_progress')
    .select('homework_deadline_at, homework_overdue_at')
    .in('homework_status', ['pending', 'rejected'])
    .not('homework_deadline_at', 'is', null)
    .limit(500);
  if (courseId != null) query = query.eq('course_id', courseId);
  const { data, error } = await query;
  if (error) {
    const message = String((error as { message?: unknown }).message ?? error);
    if (
      message.includes('homework_deadline_at') ||
      message.includes('does not exist') ||
      message.includes('Could not find')
    ) {
      return 0;
    }
    throw error;
  }
  return (data ?? []).filter((row) =>
    isOverdueHwRow(
      {
        homework_deadline_at: row.homework_deadline_at as string | null,
        homework_overdue_at: (row.homework_overdue_at as string | null) ?? null,
      },
      nowMs,
    ),
  ).length;
}

/** Был ли уже хотя бы один monthly_restore за period. */
export async function hasMonthlyRestoreForPeriod(
  admin: SupabaseClient,
  periodKey = moscowPeriodKey(),
): Promise<boolean> {
  const { data, error } = await admin
    .from('course_life_events')
    .select('id')
    .eq('operation_type', 'monthly_restore')
    .eq('period_key', periodKey)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isLivesTableError(error)) return false;
    throw error;
  }
  return Boolean(data);
}

/**
 * Нужно ли показать админу кнопку массового restore на главной.
 * Дни 1–3 МСК, есть кому восстанавливать (belowMax > 0). В «Прочее» кнопка всегда.
 */
export async function shouldPromptMonthlyLivesRestore(
  admin: SupabaseClient,
  date = new Date(),
): Promise<{ prompt: boolean; periodKey: string; belowMax: number; day: number }> {
  const periodKey = moscowPeriodKey(date);
  const day = moscowDayOfMonth(date);
  const belowMax = await countEnrollmentsBelowMaxLives(admin);
  const prompt = day >= 1 && day <= 3 && belowMax > 0;
  return { prompt, periodKey, belowMax, day };
}

export async function initEnrollmentLives(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  livesMax = 3,
): Promise<CourseEnrollmentState> {
  const existing = await getEnrollmentLives(admin, telegramId, courseId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('course_enrollment_state')
    .insert({
      telegram_id: telegramId,
      course_id: courseId,
      lives_current: livesMax,
      lives_max: livesMax,
      access_blocked: false,
      fully_blocked: false,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) {
    // Гонка: уже создали
    const again = await getEnrollmentLives(admin, telegramId, courseId);
    if (again) return again;
    throw error;
  }
  return normalizeState(data as CourseEnrollmentState);
}

export async function getEnrollmentLives(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<CourseEnrollmentState | null> {
  const { data, error } = await admin
    .from('course_enrollment_state')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeState(data as CourseEnrollmentState) : null;
}

export async function hasLifeDeductedForLesson(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  sanityLessonId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('course_life_events')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .eq('delta', -1)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function insertLifeEvent(
  admin: SupabaseClient,
  row: {
    telegramId: number;
    courseId: number;
    delta: number;
    reason: string;
    actorTelegramId: number | null;
    operationType: LifeOperationType;
    livesBefore: number;
    livesAfter: number;
    sanityLessonId?: string | null;
    courseLessonId?: number | null;
    periodKey?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from('course_life_events').insert({
    telegram_id: row.telegramId,
    course_id: row.courseId,
    delta: row.delta,
    reason: row.reason,
    curator_telegram_id: row.actorTelegramId,
    course_lesson_id: row.courseLessonId ?? null,
    sanity_lesson_id: row.sanityLessonId ?? null,
    lives_before: row.livesBefore,
    lives_after: row.livesAfter,
    operation_type: row.operationType,
    period_key: row.periodKey ?? null,
  });
  if (error) throw error;
}

/**
 * Универсальное изменение жизней.
 * При 0 — access_blocked; при after > 0 заморозка снимается (+жизнь / monthly).
 * fully_blocked начислением не снимается (только админ / repurchase reset).
 */
export async function adjustLives(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    delta: number;
    reason: string;
    actorTelegramId: number | null;
    operationType: LifeOperationType;
    sanityLessonId?: string | null;
    courseLessonId?: number | null;
    periodKey?: string | null;
    /** Позволить превысить max (обычно нет). */
    allowAboveMax?: boolean;
  },
): Promise<{ state: CourseEnrollmentState; changed: boolean }> {
  const state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    throw new Error('Ученик не зачислен на курс или жизни не инициализированы.');
  }

  const before = state.lives_current;
  let after = before + params.delta;
  if (!params.allowAboveMax) {
    after = Math.min(state.lives_max, after);
  }
  after = Math.max(0, after);

  if (after === before && params.operationType !== 'monthly_restore') {
    return { state, changed: false };
  }

  const now = new Date().toISOString();
  const hittingZero = after <= 0 && before > 0;

  try {
    await insertLifeEvent(admin, {
      telegramId: params.telegramId,
      courseId: params.courseId,
      delta: after - before,
      reason: params.reason,
      actorTelegramId: params.actorTelegramId,
      operationType: params.operationType,
      livesBefore: before,
      livesAfter: after,
      sanityLessonId: params.sanityLessonId,
      courseLessonId: params.courseLessonId,
      periodKey: params.periodKey,
    });
  } catch (error) {
    // monthly unique / deduct unique → повтор
    const code = String((error as { code?: unknown })?.code ?? '');
    if (code === '23505') {
      const fresh = await getEnrollmentLives(admin, params.telegramId, params.courseId);
      return { state: fresh ?? state, changed: false };
    }
    throw error;
  }

  const patch: Record<string, unknown> = {
    lives_current: after,
    updated_at: now,
  };
  // Заморозка при 0; снимается при +жизни / monthly restore (after > 0)
  if (after <= 0) {
    patch.access_blocked = true;
    patch.frozen_at = state.frozen_at ?? now;
    patch.frozen_reason = state.frozen_reason ?? 'Закончились жизни';
  } else if (before <= 0 || state.access_blocked) {
    patch.access_blocked = false;
    patch.frozen_at = null;
    patch.frozen_reason = null;
  }
  if (before <= 0 && after > 0) {
    patch.lives_zero_notified_at = null;
  }

  const { data, error } = await admin
    .from('course_enrollment_state')
    .update(patch)
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .select('*')
    .single();
  if (error) throw error;

  const next = normalizeState(data as CourseEnrollmentState);

  if (hittingZero) {
    void notifyLivesExhaustedOnce(admin, {
      telegramId: params.telegramId,
      courseId: params.courseId,
      state: next,
    }).catch((err) => console.error('[lives] zero notify failed:', err));
  }

  return { state: next, changed: true };
}

/** Ручная разморозка куратором/админом. Жизни не меняет. */
export async function unfreezeEnrollment(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    actorTelegramId: number;
    reason?: string;
  },
): Promise<CourseEnrollmentState> {
  let state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    state = await initEnrollmentLives(admin, params.telegramId, params.courseId);
  }
  if (!state.access_blocked) return state;

  const now = new Date().toISOString();
  const reason = params.reason?.trim() || 'Разморозка курса';

  await insertLifeEvent(admin, {
    telegramId: params.telegramId,
    courseId: params.courseId,
    delta: 0,
    reason,
    actorTelegramId: params.actorTelegramId,
    operationType: 'unfreeze',
    livesBefore: state.lives_current,
    livesAfter: state.lives_current,
  });

  const { data, error } = await admin
    .from('course_enrollment_state')
    .update({
      access_blocked: false,
      frozen_at: null,
      frozen_reason: null,
      updated_at: now,
    })
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeState(data as CourseEnrollmentState);
}

/** Списание жизни за провал по домашке. Идемпотентно по sanity_lesson_id. */
export async function deductLifeForHomeworkFailure(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    sanityLessonId: string;
    courseLessonId?: number;
    failureKind: HomeworkLifeFailureKind;
  },
): Promise<{ state: CourseEnrollmentState; deducted: boolean }> {
  const state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    throw new Error('Ученик не зачислен на курс или жизни не инициализированы.');
  }

  const already = await hasLifeDeductedForLesson(
    admin,
    params.telegramId,
    params.courseId,
    params.sanityLessonId,
  );
  if (already) return { state, deducted: false };
  if (state.lives_current <= 0) return { state, deducted: false };

  const result = await adjustLives(admin, {
    telegramId: params.telegramId,
    courseId: params.courseId,
    delta: -1,
    reason: HOMEWORK_LIFE_REASONS[params.failureKind],
    actorTelegramId: params.curatorTelegramId,
    operationType: 'deduct',
    sanityLessonId: params.sanityLessonId,
    courseLessonId: params.courseLessonId,
  });

  return { state: result.state, deducted: result.changed };
}

export async function deductLifeForMissingHomework(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    sanityLessonId: string;
    courseLessonId?: number;
    failureKind?: HomeworkLifeFailureKind;
    reason?: string;
  },
): Promise<CourseEnrollmentState> {
  const { state } = await deductLifeForHomeworkFailure(admin, {
    telegramId: params.telegramId,
    courseId: params.courseId,
    curatorTelegramId: params.curatorTelegramId,
    sanityLessonId: params.sanityLessonId,
    courseLessonId: params.courseLessonId,
    failureKind: params.failureKind ?? 'notSubmitted',
  });
  return state;
}

/** +1 жизнь (куратор/админ). Снимает обычную заморозку, не трогает fully_blocked. */
export async function grantBonusLife(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    reason: string;
  },
): Promise<CourseEnrollmentState> {
  const { state } = await adjustLives(admin, {
    telegramId: params.telegramId,
    courseId: params.courseId,
    delta: 1,
    reason: params.reason,
    actorTelegramId: params.curatorTelegramId,
    operationType: 'grant',
  });
  return state;
}

/** Полная блокировка курса администратором. */
export async function setCourseFullyBlocked(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    adminTelegramId: number;
    reason: string;
    blocked: boolean;
  },
): Promise<CourseEnrollmentState> {
  let state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    state = await initEnrollmentLives(admin, params.telegramId, params.courseId);
  }

  const now = new Date().toISOString();
  const reason = params.reason.trim() || 'Блокировка администратором';
  const { data, error } = await admin
    .from('course_enrollment_state')
    .update(
      params.blocked
        ? {
            fully_blocked: true,
            fully_blocked_at: now,
            fully_blocked_by: params.adminTelegramId,
            fully_blocked_reason: reason,
            updated_at: now,
          }
        : {
            fully_blocked: false,
            fully_blocked_at: null,
            fully_blocked_by: null,
            fully_blocked_reason: null,
            updated_at: now,
          },
    )
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .select('*')
    .single();
  if (error) throw error;

  const next = normalizeState(data as CourseEnrollmentState);
  if (params.blocked) {
    const { notifyStudentFullyBlocked } = await import('./lives-notify');
    void notifyStudentFullyBlocked(admin, params.telegramId, params.courseId, reason).catch((err) =>
      console.error('[lives] full-block notify failed:', err),
    );
  }
  return next;
}

/**
 * Сброс жизней и блокировок после повторной оплаты курса (fully_blocked → fresh start).
 * Прогресс/access чистит вызывающий код.
 */
export async function resetEnrollmentStateForRepurchase(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<CourseEnrollmentState> {
  let state = await getEnrollmentLives(admin, telegramId, courseId);
  if (!state) {
    state = await initEnrollmentLives(admin, telegramId, courseId);
  }

  const now = new Date().toISOString();
  const before = state.lives_current;
  const after = state.lives_max;

  try {
    await insertLifeEvent(admin, {
      telegramId,
      courseId,
      delta: after - before,
      reason: 'Повторная оплата курса — сброс прогресса',
      actorTelegramId: null,
      operationType: 'repurchase_reset',
      livesBefore: before,
      livesAfter: after,
    });
  } catch (error) {
    if (!isLivesTableError(error)) throw error;
  }

  const { data, error } = await admin
    .from('course_enrollment_state')
    .update({
      lives_current: after,
      access_blocked: false,
      frozen_at: null,
      frozen_reason: null,
      fully_blocked: false,
      fully_blocked_at: null,
      fully_blocked_by: null,
      fully_blocked_reason: null,
      lives_zero_notified_at: null,
      updated_at: now,
    })
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeState(data as CourseEnrollmentState);
}

/** Ежемесячное восстановление до max для одного ученика. Идемпотентно по period_key. */
export async function monthlyRestoreLivesForEnrollment(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  periodKey = moscowPeriodKey(),
): Promise<{ state: CourseEnrollmentState; restored: boolean }> {
  const state = await getEnrollmentLives(admin, telegramId, courseId);
  if (!state) {
    throw new Error('Нет состояния жизней');
  }

  if (state.lives_current >= state.lives_max) {
    // Всё равно фиксируем период? Нет — только если реально меняли.
    return { state, restored: false };
  }

  const delta = state.lives_max - state.lives_current;
  const result = await adjustLives(admin, {
    telegramId,
    courseId,
    delta,
    reason: `Ежемесячное восстановление (${periodKey})`,
    actorTelegramId: null,
    operationType: 'monthly_restore',
    periodKey,
    allowAboveMax: false,
  });

  return { state: result.state, restored: result.changed };
}

/** Пройти всех учеников с жизнями < max. */
export async function runMonthlyLivesRestore(
  admin: SupabaseClient,
  periodKey = moscowPeriodKey(),
  courseId?: number | null,
): Promise<{ processed: number; restored: number; skipped: number; errors: number }> {
  let query = admin
    .from('course_enrollment_state')
    .select('telegram_id, course_id, lives_current, lives_max');
  if (courseId != null) query = query.eq('course_id', courseId);
  const { data: all, error } = await query;
  if (error) throw error;

  let processed = 0;
  let restored = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of all ?? []) {
    const current = row.lives_current as number;
    const max = row.lives_max as number;
    if (current >= max) {
      skipped += 1;
      continue;
    }
    processed += 1;
    try {
      const result = await monthlyRestoreLivesForEnrollment(
        admin,
        row.telegram_id as number,
        row.course_id as number,
        periodKey,
      );
      if (result.restored) restored += 1;
      else skipped += 1;
    } catch (err) {
      errors += 1;
      console.error('[lives] monthly restore row failed:', err);
    }
  }

  return { processed, restored, skipped, errors };
}

export async function getLifeEvents(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  limit = 20,
): Promise<CourseLifeEvent[]> {
  const { data, error } = await admin
    .from('course_life_events')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CourseLifeEvent[];
}

export function formatLifeDeductionNote(
  lifeDeduction: {
    deducted: boolean;
    livesCurrent: number;
    livesMax: number;
    accessBlocked: boolean;
  } | null,
): string {
  if (!lifeDeduction) return '';
  if (!lifeDeduction.deducted) {
    return `\n\n❤️ Жизнь за это ДЗ уже была снята. Осталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.`;
  }
  const blocked = lifeDeduction.accessBlocked
    ? '\n\n⚠️ Доступ к новым занятиям приостановлен — 0 жизней.'
    : '';
  return `\n\n❤️ Снята 1 жизнь. Осталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.${blocked}`;
}
