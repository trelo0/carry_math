import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adjustLives,
  getEnrollmentLives,
  getLifeEvents,
  grantBonusLife,
  initEnrollmentLives,
  isLivesTableError,
  moscowPeriodKey,
  runMonthlyLivesRestore,
  setCourseFullyBlocked,
  unfreezeEnrollment,
} from '@/lib/bot/education/lives';
import { logAdminAction } from './action-log';
import {
  type AdminMessage,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
} from './core';
import { getMember } from '@/lib/bot/roles';
import { memberDisplayName } from './users';
import { getAdminLivesHubCourse, setAdminLivesHubCourse } from './lives-hub-course';
import { getCourse } from '@/lib/bot/education/courses';
import {
  livesBlockAskCb,
  livesBlockConfirmCb,
  livesDeductCb,
  livesGrantCb,
  livesHistoryCb,
  livesMenuCb,
  livesRefundCb,
  livesUnfreezeCb,
  parseLivesBlockAction,
  parseLivesOpsCourseId,
  parseLivesRefundAction,
} from './lives-ops-callbacks';

type EnrollmentCourseOption = { courseId: number; title: string };

async function listActiveEnrollmentCourses(
  admin: SupabaseClient,
  telegramId: number,
): Promise<EnrollmentCourseOption[]> {
  const { data, error } = await admin
    .from('course_enrollments')
    .select('course_id')
    .eq('telegram_id', telegramId)
    .eq('status', 'active');
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r) => r.course_id as number))];
  const out: EnrollmentCourseOption[] = [];
  for (const courseId of ids) {
    const course = await getCourse(admin, courseId);
    out.push({ courseId, title: course?.title?.trim() || `Курс #${courseId}` });
  }
  return out;
}

function backToUser(telegramId: number): InlineButton {
  return { text: '↩️ К профилю', callback_data: `admin:user:${telegramId}::` };
}

function backToLives(telegramId: number, courseId?: number | null): InlineButton {
  return { text: '↩️ К жизням', callback_data: livesMenuCb(telegramId, courseId) };
}

async function resolveCourseForStudentLives(
  admin: SupabaseClient,
  adminChatId: number,
  studentTelegramId: number,
  explicitCourseId?: number | null,
): Promise<number | null> {
  if (explicitCourseId != null && explicitCourseId > 0) {
    setAdminLivesHubCourse(adminChatId, explicitCourseId);
    return explicitCourseId;
  }
  const cached = getAdminLivesHubCourse(adminChatId);
  if (cached != null) {
    const { isStudentOnCourse } = await import('@/lib/bot/education/student-course-context');
    if (await isStudentOnCourse(admin, studentTelegramId, cached)) return cached;
  }
  const enrollments = await listActiveEnrollmentCourses(admin, studentTelegramId);
  if (enrollments.length === 1) {
    setAdminLivesHubCourse(adminChatId, enrollments[0]!.courseId);
    return enrollments[0]!.courseId;
  }
  return null;
}

async function renderLivesEnrollmentPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
  courses: EnrollmentCourseOption[],
): Promise<void> {
  const member = await getMember(admin, studentTelegramId);
  const name = member ? memberDisplayName(member) : `ID ${studentTelegramId}`;
  const lines = [
    `❤️ Жизни: ${name}`,
    '',
    'Ученик на нескольких курсах — выберите курс:',
  ];
  const keyboard: InlineButton[][] = courses.map((c) => [
    { text: c.title.slice(0, 48), callback_data: livesMenuCb(studentTelegramId, c.courseId) },
  ]);
  keyboard.push([backToUser(studentTelegramId)], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export function isLivesOpsAction(data: string): boolean {
  return data.startsWith('al:');
}

async function renderLivesMenu(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
  courseIdOverride?: number | null,
): Promise<void> {
  const member = await getMember(admin, studentTelegramId);
  const name = member ? memberDisplayName(member) : `ID ${studentTelegramId}`;
  let courseId = await resolveCourseForStudentLives(
    admin,
    message.chatId,
    studentTelegramId,
    courseIdOverride,
  );
  if (courseId == null) {
    const enrollments = await listActiveEnrollmentCourses(admin, studentTelegramId);
    if (enrollments.length > 1) {
      await renderLivesEnrollmentPicker(admin, message, studentTelegramId, enrollments);
      return;
    }
    if (enrollments.length === 1) {
      courseId = enrollments[0]!.courseId;
      setAdminLivesHubCourse(message.chatId, courseId);
    }
  }
  if (!courseId) {
    await editAdminMessage(message, 'Курс не найден — жизни недоступны.', {
      inline_keyboard: [[backToUser(studentTelegramId)], [homeButton()]],
    });
    return;
  }

  const course = await getCourse(admin, courseId);
  const courseTitle = course?.title?.trim() || `курс #${courseId}`;

  let state = await getEnrollmentLives(admin, studentTelegramId, courseId);
  if (!state) {
    state = await initEnrollmentLives(admin, studentTelegramId, courseId);
  }

  const events = await getLifeEvents(admin, studentTelegramId, courseId, 5);
  const history =
    events.length === 0
      ? 'История пуста'
      : events
          .map((e) => {
            const delta = e.delta > 0 ? `+${e.delta}` : String(e.delta);
            const span =
              e.lives_before != null && e.lives_after != null
                ? ` (${e.lives_before}→${e.lives_after})`
                : '';
            return `• ${delta}${span} — ${e.reason}`;
          })
          .join('\n');

  const lines = [
    `❤️ Жизни: ${name}`,
    `🎓 ${courseTitle}`,
    '',
    `Сейчас: ${state.lives_current} из ${state.lives_max}`,
    state.fully_blocked
      ? `🔒 Полная блокировка: да${state.fully_blocked_reason ? ` (${state.fully_blocked_reason})` : ''}`
      : '🔒 Полная блокировка: нет',
    state.access_blocked ? '⏸️ Заморозка новых занятий: да (0 жизней)' : '⏸️ Заморозка новых занятий: нет',
    '',
    'Последние операции:',
    history,
  ];

  const keyboard: InlineButton[][] = [
    [
      { text: '+1 жизнь', callback_data: livesGrantCb(studentTelegramId, courseId) },
      { text: '−1 жизнь', callback_data: livesDeductCb(studentTelegramId, courseId) },
    ],
    [{ text: '📋 История', callback_data: livesHistoryCb(studentTelegramId, courseId) }],
    [
      state.fully_blocked
        ? {
            text: '🔓 Снять полную блокировку',
            callback_data: livesBlockAskCb(studentTelegramId, courseId, false),
          }
        : {
            text: '🔒 Полная блокировка',
            callback_data: livesBlockAskCb(studentTelegramId, courseId, true),
          },
    ],
    state.access_blocked
      ? [{ text: '▶️ Разморозить курс', callback_data: livesUnfreezeCb(studentTelegramId, courseId) }]
      : [],
    [
      { text: '💸 Возврат: да', callback_data: livesRefundCb(studentTelegramId, courseId, true) },
      { text: '💸 Возврат: нет', callback_data: livesRefundCb(studentTelegramId, courseId, false) },
    ],
    [{ text: '⬅️ К разделу жизней', callback_data: 'ae:lives' }],
    [backToUser(studentTelegramId)],
    [homeButton()],
  ].filter((row) => row.length > 0);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderHistory(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
  courseIdOverride?: number | null,
): Promise<void> {
  const courseId = await resolveCourseForStudentLives(
    admin,
    message.chatId,
    studentTelegramId,
    courseIdOverride,
  );
  if (!courseId) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[backToLives(studentTelegramId)], [homeButton()]],
    });
    return;
  }

  const events = await getLifeEvents(admin, studentTelegramId, courseId, 20);
  const body =
    events.length === 0
      ? 'История пуста.'
      : events
          .map((e) => {
            const when = new Date(e.created_at).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            const delta = e.delta > 0 ? `+${e.delta}` : String(e.delta);
            const span =
              e.lives_before != null && e.lives_after != null
                ? ` ${e.lives_before}→${e.lives_after}`
                : '';
            return `${when} · ${delta}${span}\n${e.reason}`;
          })
          .join('\n\n');

  await editAdminMessage(message, `📋 История жизней\n\n${body}`, {
    inline_keyboard: [[backToLives(studentTelegramId, courseId)], [homeButton()]],
  });
}

export async function handleMonthlyLivesRestoreAction(
  admin: SupabaseClient,
  message: AdminMessage,
  adminTelegramId: number,
  courseId?: number | null,
): Promise<void> {
  const deliver = editDeliver(message);
  const periodKey = moscowPeriodKey();
  const courseTitle =
    courseId != null ? (await getCourse(admin, courseId))?.title?.trim() : null;
  try {
    const summary = await runMonthlyLivesRestore(admin, periodKey, courseId);
    await logAdminAction(admin, {
      actorTelegramId: adminTelegramId,
      action: 'lives.monthly_restore',
      entityType: 'course_enrollment_state',
      detail: { periodKey, courseId: courseId ?? null, ...summary },
    });
    await editAdminMessage(
      message,
      [
        '❤️ Ежемесячное восстановление жизней',
        courseTitle ? `🎓 ${courseTitle}` : 'Все курсы',
        '',
        `Период: ${periodKey} (МСК)`,
        `Восстановлено: ${summary.restored}`,
        `Уже были полные / пропуск: ${summary.skipped}`,
        `Ошибок: ${summary.errors}`,
        '',
        'Заморозка снята у тех, кому восстановили жизни (> 0).',
      ].join('\n'),
      {
        inline_keyboard: [[{ text: '⬅️ На главную', callback_data: 'ah:home' }], [homeButton()]],
      },
    );
  } catch (error) {
    if (isLivesTableError(error)) {
      await deliver('Таблицы жизней недоступны.', homeOnlyKeyboard());
      return;
    }
    console.error('[admin monthly restore]', error);
    await deliver('❌ Не удалось восстановить жизни.', homeOnlyKeyboard());
  }
}

export async function handleLivesOpsAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  adminTelegramId: number,
): Promise<boolean> {
  if (!isLivesOpsAction(data)) return false;

  const deliver = editDeliver(message);
  const parts = data.split(':');
  const action = parts[1] ?? '';

  // al:rm или al:rm:{courseId}
  if (action === 'rm') {
    const rawCourse = parts[2];
    const scopedCourse =
      rawCourse != null && rawCourse !== '' ? Number(rawCourse) : undefined;
    const courseId =
      scopedCourse != null && Number.isFinite(scopedCourse) && scopedCourse > 0
        ? scopedCourse
        : undefined;
    await handleMonthlyLivesRestoreAction(admin, message, adminTelegramId, courseId);
    return true;
  }

  const studentTelegramId = Number(parts[2]);

  if (!Number.isSafeInteger(studentTelegramId) || studentTelegramId <= 0) {
    await deliver('Некорректный ученик.', homeOnlyKeyboard());
    return true;
  }

  const explicitCourseId = parseLivesOpsCourseId(parts, action);

  try {
    if (action === 'm') {
      await renderLivesMenu(admin, message, studentTelegramId, explicitCourseId);
      return true;
    }

    if (action === 'h') {
      await renderHistory(admin, message, studentTelegramId, explicitCourseId);
      return true;
    }

    let courseId = await resolveCourseForStudentLives(
      admin,
      message.chatId,
      studentTelegramId,
      explicitCourseId,
    );
    if (!courseId) {
      await deliver('Выберите курс в меню «Жизни».', homeOnlyKeyboard());
      return true;
    }

    if (action === 'g') {
      await grantBonusLife(admin, {
        telegramId: studentTelegramId,
        courseId,
        curatorTelegramId: adminTelegramId,
        reason: 'Начисление администратором',
      });
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: 'lives.grant',
        entityType: 'course_enrollment_state',
        entityId: courseId,
        targetTelegramId: studentTelegramId,
        detail: { delta: 1 },
      });
      await renderLivesMenu(admin, message, studentTelegramId, courseId);
      return true;
    }

    if (action === 'd') {
      await adjustLives(admin, {
        telegramId: studentTelegramId,
        courseId,
        delta: -1,
        reason: 'Списание администратором',
        actorTelegramId: adminTelegramId,
        operationType: 'correction',
      });
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: 'lives.deduct',
        entityType: 'course_enrollment_state',
        entityId: courseId,
        targetTelegramId: studentTelegramId,
        detail: { delta: -1 },
      });
      await renderLivesMenu(admin, message, studentTelegramId, courseId);
      return true;
    }

    if (action === 'b') {
      const parsed = parseLivesBlockAction(parts, courseId);
      const blockCourseId = parsed.courseId ?? courseId;
      if (blockCourseId == null) {
        await deliver('Курс не найден.', homeOnlyKeyboard());
        return true;
      }
      const { blocked, confirm } = parsed;
      if (!confirm) {
        await editAdminMessage(
          message,
          blocked
            ? 'Заблокировать курс полностью? Материалы и ДЗ станут недоступны.'
            : 'Снять полную блокировку курса?',
          {
            inline_keyboard: [
              [
                {
                  text: blocked ? '🔒 Да, заблокировать' : '🔓 Да, разблокировать',
                  callback_data: livesBlockConfirmCb(studentTelegramId, blockCourseId, blocked),
                },
              ],
              [backToLives(studentTelegramId, blockCourseId)],
            ],
          },
        );
        return true;
      }

      await setCourseFullyBlocked(admin, {
        telegramId: studentTelegramId,
        courseId: blockCourseId,
        adminTelegramId,
        reason: blocked ? 'Блокировка администратором' : '',
        blocked,
      });
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: blocked ? 'course.full_block' : 'course.full_unblock',
        entityType: 'course_enrollment_state',
        entityId: blockCourseId,
        targetTelegramId: studentTelegramId,
      });
      await renderLivesMenu(admin, message, studentTelegramId, blockCourseId);
      return true;
    }

    if (action === 'u') {
      await unfreezeEnrollment(admin, {
        telegramId: studentTelegramId,
        courseId,
        actorTelegramId: adminTelegramId,
        reason: 'Разморозка администратором',
      });
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: 'course.unfreeze',
        entityType: 'course_enrollment_state',
        entityId: courseId,
        targetTelegramId: studentTelegramId,
      });
      await renderLivesMenu(admin, message, studentTelegramId, courseId);
      return true;
    }

    if (action === 'rf') {
      const refund = parseLivesRefundAction(parts);
      const refundCourseId = refund.courseId ?? courseId;
      if (refundCourseId == null) {
        await deliver('Курс не найден.', homeOnlyKeyboard());
        return true;
      }
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: 'purchase.refund_decision',
        entityType: 'course_enrollment',
        entityId: refundCourseId,
        targetTelegramId: studentTelegramId,
        detail: { refund: refund.refundYes, note: 'Решение зафиксировано без вызова bePaid' },
      });
      await editAdminMessage(
        message,
        refund.refundYes
          ? '💸 Решение: возврат — зафиксировано в журнале (без bePaid).'
          : '💸 Решение: без возврата — зафиксировано в журнале.',
        {
          inline_keyboard: [[backToLives(studentTelegramId, refundCourseId)], [homeButton()]],
        },
      );
      return true;
    }

    await renderLivesMenu(admin, message, studentTelegramId, courseId);
    return true;
  } catch (error) {
    if (isLivesTableError(error)) {
      await deliver('Таблицы жизней недоступны. Примените миграцию course_lives_freeze_and_full_block.sql', homeOnlyKeyboard());
      return true;
    }
    console.error('[admin lives-ops]', error);
    await deliver('❌ Не удалось выполнить операцию с жизнями.', homeOnlyKeyboard());
    return true;
  }
}
