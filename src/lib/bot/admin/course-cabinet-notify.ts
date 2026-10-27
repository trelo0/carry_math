import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { staffStudentLabel } from '../staff/messaging';

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

async function resolveCourseTitle(
  admin: SupabaseClient,
  courseId: number | null | undefined,
): Promise<string | null> {
  if (courseId == null || !Number.isFinite(courseId)) return null;
  const { data } = await admin.from('courses').select('title').eq('id', courseId).maybeSingle();
  const title = data?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

/** Первое «Открыть курс» в кабинете — пуш админам с кнопкой написать ученику от бота. */
export async function notifyAdminsOfCourseCabinetOpen(
  admin: SupabaseClient,
  studentTelegramId: number,
  courseId?: number | null,
): Promise<number> {
  const chatIds = await getAdminChatIds(admin);
  if (chatIds.length === 0) return 0;

  const [label, courseTitle] = await Promise.all([
    staffStudentLabel(admin, studentTelegramId),
    resolveCourseTitle(admin, courseId ?? null),
  ]);

  const lines = [
    '🎓 НА КУРСЕ НОВЫЙ УЧАСТНИК',
    '',
    `👤 ${label}`,
    courseTitle ? `📚 ${courseTitle}` : null,
    '',
    'Свяжитесь, чтобы узнать, как ему курс.',
  ].filter(Boolean) as string[];

  const { notifyPrimaryAdminMainChatInbox } = await import('@/lib/bot/admin/admin-guest-inbox');
  const inboxOk = await notifyPrimaryAdminMainChatInbox(admin, studentTelegramId, {
    kind: 'support',
    header: lines[0] ?? '🎓 Уведомление',
    body: lines.slice(2).join('\n'),
  });
  if (inboxOk) return 1;

  const keyboard = {
    inline_keyboard: [[{ text: '✉️ Связаться', callback_data: `ah:msg:w:${studentTelegramId}` }]],
  };

  let sent = 0;
  for (const chatId of chatIds) {
    const result = await telegramSend('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      reply_markup: keyboard,
    });
    if (result.ok) sent += 1;
    else console.error('[course-cabinet] admin notify failed:', result.description);
  }
  return sent;
}
