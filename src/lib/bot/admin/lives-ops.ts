import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
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
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
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

async function resolveStudentCourseId(admin: SupabaseClient): Promise<number | null> {
  const content = await getDistrictCourseContent();
  if (!content) return null;
  return resolveCourseIdForContent(admin, content);
}

function backToUser(telegramId: number): InlineButton {
  return { text: '↩️ К профилю', callback_data: `admin:user:${telegramId}::` };
}

function backToLives(telegramId: number): InlineButton {
  return { text: '↩️ К жизням', callback_data: `al:m:${telegramId}` };
}

export function isLivesOpsAction(data: string): boolean {
  return data.startsWith('al:');
}

async function renderLivesMenu(
  admin: SupabaseClient,
  message: AdminMessage,
  studentTelegramId: number,
): Promise<void> {
  const member = await getMember(admin, studentTelegramId);
  const name = member ? memberDisplayName(member) : `ID ${studentTelegramId}`;
  const courseId = await resolveStudentCourseId(admin);

  if (!courseId) {
    await editAdminMessage(message, 'Курс не найден — жизни недоступны.', {
      inline_keyboard: [[backToUser(studentTelegramId)], [homeButton()]],
    });
    return;
  }

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
      { text: '+1 жизнь', callback_data: `al:g:${studentTelegramId}` },
      { text: '−1 жизнь', callback_data: `al:d:${studentTelegramId}` },
    ],
    [{ text: '📋 История', callback_data: `al:h:${studentTelegramId}` }],
    [
      state.fully_blocked
        ? { text: '🔓 Снять полную блокировку', callback_data: `al:b:${studentTelegramId}:0` }
        : { text: '🔒 Полная блокировка', callback_data: `al:b:${studentTelegramId}:1` },
    ],
    state.access_blocked
      ? [{ text: '▶️ Разморозить курс', callback_data: `al:u:${studentTelegramId}` }]
      : [],
    [
      { text: '💸 Возврат: да', callback_data: `al:rf:${studentTelegramId}:yes` },
      { text: '💸 Возврат: нет', callback_data: `al:rf:${studentTelegramId}:no` },
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
): Promise<void> {
  const courseId = await resolveStudentCourseId(admin);
  if (!courseId) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[backToUser(studentTelegramId)], [homeButton()]],
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
    inline_keyboard: [[backToLives(studentTelegramId)], [homeButton()]],
  });
}

export async function handleMonthlyLivesRestoreAction(
  admin: SupabaseClient,
  message: AdminMessage,
  adminTelegramId: number,
): Promise<void> {
  const deliver = editDeliver(message);
  const periodKey = moscowPeriodKey();
  try {
    const summary = await runMonthlyLivesRestore(admin, periodKey);
    await logAdminAction(admin, {
      actorTelegramId: adminTelegramId,
      action: 'lives.monthly_restore',
      entityType: 'course_enrollment_state',
      detail: { periodKey, ...summary },
    });
    await editAdminMessage(
      message,
      [
        '❤️ Ежемесячное восстановление жизней',
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

  // Массовое восстановление: al:rm (без telegram id)
  if (action === 'rm') {
    await handleMonthlyLivesRestoreAction(admin, message, adminTelegramId);
    return true;
  }

  const studentTelegramId = Number(parts[2]);

  if (!Number.isSafeInteger(studentTelegramId) || studentTelegramId <= 0) {
    await deliver('Некорректный ученик.', homeOnlyKeyboard());
    return true;
  }

  try {
    if (action === 'm') {
      await renderLivesMenu(admin, message, studentTelegramId);
      return true;
    }

    if (action === 'h') {
      await renderHistory(admin, message, studentTelegramId);
      return true;
    }

    const courseId = await resolveStudentCourseId(admin);
    if (!courseId) {
      await deliver('Курс не найден.', homeOnlyKeyboard());
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
      await renderLivesMenu(admin, message, studentTelegramId);
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
      await renderLivesMenu(admin, message, studentTelegramId);
      return true;
    }

    if (action === 'b') {
      const blocked = parts[3] === '1';
      const confirm = parts[4] === 'c';
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
                  callback_data: `al:b:${studentTelegramId}:${blocked ? '1' : '0'}:c`,
                },
              ],
              [backToLives(studentTelegramId)],
            ],
          },
        );
        return true;
      }

      await setCourseFullyBlocked(admin, {
        telegramId: studentTelegramId,
        courseId,
        adminTelegramId,
        reason: blocked ? 'Блокировка администратором' : '',
        blocked,
      });
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: blocked ? 'course.full_block' : 'course.full_unblock',
        entityType: 'course_enrollment_state',
        entityId: courseId,
        targetTelegramId: studentTelegramId,
      });
      await renderLivesMenu(admin, message, studentTelegramId);
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
      await renderLivesMenu(admin, message, studentTelegramId);
      return true;
    }

    if (action === 'rf') {
      const decided = parts[3] === 'yes';
      await logAdminAction(admin, {
        actorTelegramId: adminTelegramId,
        action: 'purchase.refund_decision',
        entityType: 'course_enrollment',
        entityId: courseId,
        targetTelegramId: studentTelegramId,
        detail: { refund: decided, note: 'Решение зафиксировано без вызова bePaid' },
      });
      await editAdminMessage(
        message,
        decided
          ? '💸 Решение: возврат — зафиксировано в журнале (без bePaid).'
          : '💸 Решение: без возврата — зафиксировано в журнале.',
        {
          inline_keyboard: [[backToLives(studentTelegramId)], [homeButton()]],
        },
      );
      return true;
    }

    await renderLivesMenu(admin, message, studentTelegramId);
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
