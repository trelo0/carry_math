import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getStudentCurator } from '@/lib/bot/education/assignments';
import type { CourseEnrollmentState } from './lives';

async function memberChatId(admin: SupabaseClient, telegramId: number): Promise<number | null> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id, full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return (data?.chat_id as number | null) ?? null;
}

async function memberName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return (data?.full_name as string | null)?.trim() || `Ученик ${telegramId}`;
}

async function courseTitle(admin: SupabaseClient, courseId: number): Promise<string> {
  const { data } = await admin.from('courses').select('title').eq('id', courseId).maybeSingle();
  return (data?.title as string | null)?.trim() || 'Курс';
}

async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

/**
 * Один раз на эпизод исчерпания жизней (живёт в lives_zero_notified_at).
 * Ученик + куратор + админы.
 */
export async function notifyLivesExhaustedOnce(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    state: CourseEnrollmentState;
  },
): Promise<void> {
  if (params.state.lives_zero_notified_at) return;
  if (params.state.lives_current > 0) return;

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('course_enrollment_state')
    .update({ lives_zero_notified_at: now, updated_at: now })
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .is('lives_zero_notified_at', null)
    .select('telegram_id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return; // уже уведомили

  const [name, title, studentChat, curator] = await Promise.all([
    memberName(admin, params.telegramId),
    courseTitle(admin, params.courseId),
    memberChatId(admin, params.telegramId),
    getStudentCurator(admin, params.telegramId),
  ]);

  const when = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (studentChat) {
    await telegramSend('sendMessage', {
      chat_id: studentChat,
      text: [
        '⏸️ Курс заморожен',
        '',
        `Курс: ${title}`,
        'Причина: закончились жизни (0 из 3).',
        '',
        'Ранее открытые занятия и текущее ДЗ остаются доступны.',
        'Новые занятия откроются после восстановления жизней (+1 от куратора или в начале месяца).',
        '',
        'Свяжитесь с куратором.',
      ].join('\n'),
    });
  }

  if (curator) {
    const curatorChat = await memberChatId(admin, curator.telegramId);
    if (curatorChat) {
      await telegramSend('sendMessage', {
        chat_id: curatorChat,
        text: [
          '❤️ У ученика закончились жизни — курс заморожен',
          '',
          `👤 ${name}`,
          `📚 ${title}`,
          'Жизней: 0 из 3',
          'Новые занятия закрыты, пока жизни не восстановят (+1 или начало месяца).',
          '',
          'Откройте карточку ученика в кабинете куратора.',
        ].join('\n'),
      });
    }
  }

  const adminChats = await getAdminChatIds(admin);
  for (const chatId of adminChats) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: [
        '❤️ Исчерпаны жизни ученика',
        '',
        `👤 ${name}`,
        `📚 ${title}`,
        `🕐 ${when} (МСК)`,
        'Жизней: 0 — курс заморожен до восстановления жизней.',
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '❤️ Жизни', callback_data: `al:m:${params.telegramId}` },
            { text: '+1', callback_data: `al:g:${params.telegramId}` },
            { text: '−1', callback_data: `al:d:${params.telegramId}` },
          ],
          [{ text: '👤 Профиль', callback_data: `admin:user:${params.telegramId}::` }],
          [{ text: '💬 Связаться с учеником', url: `tg://user?id=${params.telegramId}` }],
        ],
      },
    });
  }
}

export async function notifyStudentFullyBlocked(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  reason: string,
): Promise<void> {
  const [chatId, title] = await Promise.all([
    memberChatId(admin, telegramId),
    courseTitle(admin, courseId),
  ]);
  if (!chatId) return;
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: [
      '🔒 Курс полностью заблокирован',
      '',
      `Курс: ${title}`,
      reason.trim() ? `Причина: ${reason.trim()}` : null,
      '',
      'Доступ к материалам закрыт. Свяжитесь с администрацией.',
    ]
      .filter(Boolean)
      .join('\n'),
  });
}
