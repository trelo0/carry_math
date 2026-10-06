import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminMessage, AdminPayload, ConversationState, InlineButton } from './core';
import {
  clearStateIfAvailable,
  editAdminMessage,
  homeButton,
  migrationText,
  saveState,
  shorten,
} from './core';
import {
  broadcastJobsAvailable,
  cancelScheduledBroadcast,
  createBroadcastJob,
  listScheduledBroadcasts,
  updateScheduledBroadcastTime,
} from './broadcast-jobs';
import { formatBroadcastDate, isBroadcastTableError } from './broadcasts';
import { logAdminAction } from './action-log';

const MSK_OFFSET_MS = 3 * 3600000;
const MS_DAY = 86400000;

function mskMidnightMs(from = Date.now()): number {
  return Math.floor((from + MSK_OFFSET_MS) / MS_DAY) * MS_DAY - MSK_OFFSET_MS;
}

export function buildScheduledIso(dayOffset: number, hour: number, minute: number): string {
  const base = mskMidnightMs() + dayOffset * MS_DAY;
  return new Date(base + hour * 3600000 + minute * 60000).toISOString();
}

export function buildScheduledIsoFromDateMs(dateMs: number, hour: number, minute: number): string {
  return new Date(dateMs + hour * 3600000 + minute * 60000).toISOString();
}

/** DD.MM или DD.MM.YYYY (Europe/Moscow, полночь выбранного дня). */
export function parseCustomScheduleDate(text: string): number | null {
  const trimmed = text.trim().replace(/\s+/g, '');
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const utcGuess = Date.UTC(year, month - 1, day);
  const mskMidnight = utcGuess - MSK_OFFSET_MS;
  const check = new Date(mskMidnight + MSK_OFFSET_MS);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  if (mskMidnight < mskMidnightMs() - MS_DAY) return null;
  return mskMidnight;
}

export async function promptCustomScheduleTime(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
  dayKey: string,
): Promise<void> {
  await saveState(admin, telegramId, message, 'broadcast:schedule:time', { ...payload, schedulePlanDayKey: dayKey });
  await editAdminMessage(message, '🕐 Другое время\n\nВведите время в формате ЧЧ:ММ\n\nНапример: 10:30', {
    inline_keyboard: [
      [{ text: '⬅️ Назад', callback_data: dayKey === 'x' ? 'admin:bc:plan:day:custom' : `admin:bc:plan:day:${dayKey}` }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      [homeButton()],
    ],
  });
}

export function parseScheduleTime(text: string): { hour: number; minute: number } | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function resolveScheduledIso(payload: AdminPayload, dayKey: string, hour: number, minute: number): string {
  if (dayKey === 'x' && payload.scheduleCustomDateMs) {
    return buildScheduledIsoFromDateMs(payload.scheduleCustomDateMs, hour, minute);
  }
  const dayOffset = Number(dayKey) || 0;
  return buildScheduledIso(dayOffset, hour, minute);
}

export async function promptCustomScheduleDate(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
): Promise<void> {
  await saveState(admin, telegramId, message, 'broadcast:schedule:date', payload);
  await editAdminMessage(message, '📅 Другая дата\n\nВведите дату в формате ДД.ММ или ДД.ММ.ГГГГ\n\nНапример: 15.10', {
    inline_keyboard: [
      [{ text: '⬅️ Назад', callback_data: 'admin:bc:plan' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      [homeButton()],
    ],
  });
}

export function formatScheduleLabel(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(iso));
}

export async function renderScheduleTimePicker(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
  dayOffset: number,
): Promise<void> {
  const dayLabel = payload.scheduleCustomDateMs
    ? formatScheduleLabel(new Date(payload.scheduleCustomDateMs).toISOString()).split(',')[0]
    : dayOffset === 0
      ? 'сегодня'
      : dayOffset === 1
        ? 'завтра'
        : `+${dayOffset} дн.`;
  const slots = [
    { h: 9, m: 0, label: '09:00' },
    { h: 10, m: 0, label: '10:00' },
    { h: 12, m: 0, label: '12:00' },
    { h: 15, m: 0, label: '15:00' },
    { h: 18, m: 0, label: '18:00' },
  ];

  await saveState(admin, telegramId, message, 'broadcast:preview', {
    ...payload,
    scheduleDayOffset: dayOffset,
  });

  const dayKey = payload.scheduleCustomDateMs ? 'x' : String(dayOffset);
  const keyboard: InlineButton[][] = slots.map((s) => [
    {
      text: s.label,
      callback_data: `admin:bc:plan:at:${dayKey}:${s.h}:${s.m}`,
    },
  ]);
  keyboard.push([{ text: 'Другое', callback_data: `admin:bc:plan:time:custom:${dayKey}` }]);
  keyboard.push(
    [{ text: '⬅️ Дата', callback_data: 'admin:bc:plan' }],
    [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
    [homeButton()],
  );

  await editAdminMessage(message, `🕐 Выберите время\n\nДата: ${dayLabel}`, { inline_keyboard: keyboard });
}

export async function renderScheduleDatePicker(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
): Promise<void> {
  await saveState(admin, telegramId, message, 'broadcast:preview', payload);
  await editAdminMessage(message, '🕐 Время отправки\n\nВыберите дату:', {
    inline_keyboard: [
      [{ text: 'Сегодня', callback_data: 'admin:bc:plan:day:0' }],
      [{ text: 'Завтра', callback_data: 'admin:bc:plan:day:1' }],
      [{ text: '📅 Другая дата', callback_data: 'admin:bc:plan:day:custom' }],
      [{ text: '⬅️ Предпросмотр', callback_data: 'admin:bc:preview' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      [homeButton()],
    ],
  });
}

export async function renderScheduleConfirm(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
  scheduledIso: string,
  recipientCount: number,
): Promise<void> {
  await saveState(admin, telegramId, message, 'broadcast:preview', {
    ...payload,
    scheduledAtIso: scheduledIso,
  });

  await editAdminMessage(
    message,
    [
      '🕐 Запланировать рассылку',
      '',
      `Получателей: ${recipientCount}`,
      `Дата: ${formatScheduleLabel(scheduledIso)}`,
      '',
      `Сообщение: «${shorten((payload.broadcastText ?? '').replace(/\n/g, ' '), 80)}»`,
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '✅ Запланировать', callback_data: 'admin:bc:plan:save' }],
        [{ text: '✏️ Изменить', callback_data: 'admin:bc:plan' }],
        [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      ],
    },
  );
}

export async function saveScheduledBroadcast(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  payload: AdminPayload,
  audienceId: string,
  audienceTitle: string,
  chatIds: number[],
): Promise<void> {
  if (!(await broadcastJobsAvailable(admin))) {
    await editAdminMessage(message, migrationText('bot_broadcasts_phase2.sql'), {
      inline_keyboard: [[{ text: '⬅️ Рассылки', callback_data: 'admin:broadcasts' }], [homeButton()]],
    });
    return;
  }

  const scheduledAt = payload.scheduledAtIso;
  const rescheduleId = payload.broadcastRescheduleId;
  if (!scheduledAt || (!payload.broadcastText && !rescheduleId)) {
    await editAdminMessage(message, '⚠️ Не удалось запланировать: не хватает данных.', {
      inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }], [homeButton()]],
    });
    return;
  }

  if (rescheduleId) {
    const ok = await updateScheduledBroadcastTime(admin, rescheduleId, scheduledAt);
    await clearStateIfAvailable(admin, telegramId);
    await editAdminMessage(
      message,
      ok
        ? ['✅ Время рассылки обновлено', '', formatScheduleLabel(scheduledAt)].join('\n')
        : '⚠️ Не удалось изменить время (рассылка уже отправляется или не найдена).',
      {
        inline_keyboard: [
          [{ text: '🕐 Запланированные', callback_data: 'admin:bc:scheduled' }],
          [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
          [homeButton()],
        ],
      },
    );
    return;
  }

  const id = await createBroadcastJob(admin, {
    adminTelegramId: telegramId,
    adminNotifyChatId: message.chatId,
    audienceId,
    audienceTitle,
    payload,
    chatIds,
    status: 'scheduled',
    scheduledAt,
  });

  if (!id) {
    await editAdminMessage(message, migrationText('bot_broadcasts_phase2.sql'), {
      inline_keyboard: [[{ text: '⬅️ Рассылки', callback_data: 'admin:broadcasts' }], [homeButton()]],
    });
    return;
  }

  await logAdminAction(admin, {
    actorTelegramId: telegramId,
    action: 'broadcast.schedule',
    entityType: 'broadcast',
    entityId: id,
    detail: { scheduledAt, recipients: chatIds.length },
  });

  await clearStateIfAvailable(admin, telegramId);

  await editAdminMessage(
    message,
    [
      '✅ Рассылка запланирована',
      '',
      formatScheduleLabel(scheduledAt),
      `${chatIds.length} получателей`,
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '🕐 Запланированные', callback_data: 'admin:bc:scheduled' }],
        [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
        [homeButton()],
      ],
    },
  );
}

export async function renderScheduledList(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  try {
    const rows = await listScheduledBroadcasts(admin, 8);
    if (rows.length === 0) {
      await editAdminMessage(message, '🕐 Запланированные\n\nЗапланированных рассылок пока нет.', {
        inline_keyboard: [
          [{ text: '➕ Создать рассылку', callback_data: 'admin:bc:new' }],
          [{ text: '⬅️ Рассылки', callback_data: 'admin:broadcasts' }],
          [homeButton()],
        ],
      });
      return;
    }

    const lines = ['🕐 Запланированные', ''];
    const keyboard: InlineButton[][] = [];
    rows.forEach((row, i) => {
      const when = row.scheduled_at ? formatScheduleLabel(row.scheduled_at) : '—';
      lines.push(
        `${i + 1}. 📢 ${row.title ?? row.audience_title}`,
        `   ${row.recipients} получателей`,
        `   ${when}`,
        '',
      );
      keyboard.push([{ text: `#${row.id} · ${when}`, callback_data: `admin:bc:sched:view:${row.id}` }]);
    });
    keyboard.push([{ text: '⬅️ Рассылки', callback_data: 'admin:broadcasts' }]);
    keyboard.push([homeButton()]);

    await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    await editAdminMessage(message, migrationText('bot_broadcasts.sql'), {
      inline_keyboard: [[{ text: '⬅️ Рассылки', callback_data: 'admin:broadcasts' }], [homeButton()]],
    });
  }
}

export async function renderScheduledDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  id: number,
): Promise<void> {
  const { data, error } = await admin
    .from('bot_broadcasts')
    .select('id, status, scheduled_at, audience_title, title, recipients, text_preview')
    .eq('id', id)
    .eq('status', 'scheduled')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await editAdminMessage(message, 'Рассылка не найдена или уже отправлена.', {
      inline_keyboard: [[{ text: '🕐 Запланированные', callback_data: 'admin:bc:scheduled' }], [homeButton()]],
    });
    return;
  }

  const when = data.scheduled_at ? formatBroadcastDate(String(data.scheduled_at)) : '—';
  await editAdminMessage(
    message,
    [
      '📢 Запланированная рассылка',
      '',
      `👥 Получателей: ${data.recipients}`,
      `🕐 ${when}`,
      '',
      'Статус:',
      '🕐 Ожидает отправки',
      '',
      `«${shorten(String(data.text_preview), 120)}»`,
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '✏️ Изменить время', callback_data: `admin:bc:sched:edit:${id}` }],
        [{ text: '❌ Отменить', callback_data: `admin:bc:sched:cancel:${id}` }],
        [{ text: '⬅️ Назад', callback_data: 'admin:bc:scheduled' }],
        [homeButton()],
      ],
    },
  );
}

export async function startBroadcastReschedule(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  broadcastId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('bot_broadcasts')
    .select('payload, audience_id, audience_title, text_preview')
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await editAdminMessage(message, 'Рассылка не найдена.', {
      inline_keyboard: [[{ text: '🕐 Запланированные', callback_data: 'admin:bc:scheduled' }], [homeButton()]],
    });
    return;
  }
  const stored = (data.payload as Record<string, unknown> | null) ?? {};
  await saveState(admin, telegramId, message, 'broadcast:preview', {
    audience: String(data.audience_id ?? stored.audience ?? ''),
    audienceTitle: String(data.audience_title ?? stored.audienceTitle ?? ''),
    broadcastText: String(stored.broadcastText ?? data.text_preview ?? '—'),
    broadcastRescheduleId: broadcastId,
    attachmentKind: stored.attachmentKind as AdminPayload['attachmentKind'],
    fileId: stored.fileId as string | undefined,
    buttonText: stored.buttonText as string | undefined,
    buttonUrl: stored.buttonUrl as string | undefined,
  });
  await renderScheduleDatePicker(admin, telegramId, message, {
    broadcastRescheduleId: broadcastId,
    broadcastText: String(stored.broadcastText ?? data.text_preview ?? ''),
  });
}

export async function confirmCancelScheduled(
  admin: SupabaseClient,
  message: AdminMessage,
  id: number,
): Promise<void> {
  await editAdminMessage(message, '⚠️ Отменить запланированную рассылку?', {
    inline_keyboard: [
      [{ text: '✅ Да, отменить', callback_data: `admin:bc:sched:cancel:yes:${id}` }],
      [{ text: '❌ Нет', callback_data: `admin:bc:sched:view:${id}` }],
    ],
  });
}

export async function executeCancelScheduled(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  id: number,
): Promise<void> {
  const ok = await cancelScheduledBroadcast(admin, id);
  if (ok) {
    await logAdminAction(admin, {
      actorTelegramId: telegramId,
      action: 'broadcast.cancel',
      entityType: 'broadcast',
      entityId: id,
    });
  }
  await editAdminMessage(
    message,
    ok ? '✅ Запланированная рассылка отменена.' : '⚠️ Не удалось отменить (уже отправляется или не найдена).',
    {
      inline_keyboard: [[{ text: '🕐 Запланированные', callback_data: 'admin:bc:scheduled' }], [homeButton()]],
    },
  );
}
