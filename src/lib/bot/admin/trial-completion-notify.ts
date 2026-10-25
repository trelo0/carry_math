import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getMember } from '@/lib/bot/roles';
import { memberDisplayName } from './users';

export async function notifyAdminsTrialCompleted(
  admin: SupabaseClient,
  input: {
    studentTelegramId: number;
    studentName: string;
    formatLabel: string;
    teacherName: string;
    leadId: string | null;
    lessonId: number;
  },
): Promise<boolean> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';
  const { data } = await admin.from('bot_members').select('chat_id').or(roleFilter).not('chat_id', 'is', null);

  const text = [
    'Пробное занятие завершено.',
    '',
    `Ученик: ${input.studentName}`,
    `Формат: ${input.formatLabel}`,
    `Преподаватель: ${input.teacherName}`,
    '',
    'Свяжитесь с учеником и уточните, планирует ли он продолжать обучение.',
  ].join('\n');

  const keyboard = input.leadId
    ? { inline_keyboard: [[{ text: '👤 Заявка', callback_data: `al:l:${input.leadId}:w:0` }]] }
    : { inline_keyboard: [[{ text: '👤 Ученик', callback_data: `admin:user:${input.studentTelegramId}::` }]] };

  let sent = false;
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number }).chat_id;
    if (!chatId) continue;
    await telegramSend('sendMessage', { chat_id: chatId, text, reply_markup: keyboard });
    sent = true;
  }
  return sent;
}

export async function maybeNotifyTrialLessonCompleted(
  admin: SupabaseClient,
  lessonId: number,
): Promise<void> {
  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select(
      'id, kind, status, telegram_id, teacher_telegram_id, lead_id, lesson_format, group_id, trial_admin_notified_at, purchase_request_id',
    )
    .eq('id', lessonId)
    .maybeSingle();
  if (!lesson || lesson.kind !== 'trial' || lesson.status !== 'completed') return;
  if (lesson.trial_admin_notified_at) return;

  const now = new Date().toISOString();
  const { data: locked } = await admin
    .from('scheduled_lessons')
    .update({ trial_admin_notified_at: now, updated_at: now })
    .eq('id', lessonId)
    .eq('kind', 'trial')
    .is('trial_admin_notified_at', null)
    .select('id')
    .maybeSingle();
  if (!locked) return;

  let formatLabel = 'индивидуальное';
  if (lesson.group_id) formatLabel = 'групповое';
  else {
    const { data: order } = lesson.purchase_request_id
      ? await admin
          .from('purchase_requests')
          .select('lesson_format')
          .eq('id', lesson.purchase_request_id as string)
          .maybeSingle()
      : { data: null };
    if (order?.lesson_format === 'group') formatLabel = 'групповое';
  }

  const student = await getMember(admin, lesson.telegram_id as number);
  const studentName = student ? memberDisplayName(student) : `ID ${lesson.telegram_id}`;

  let teacherName = '—';
  if (lesson.teacher_telegram_id) {
    const teacher = await getMember(admin, lesson.teacher_telegram_id as number);
    teacherName = teacher ? memberDisplayName(teacher) : `ID ${lesson.teacher_telegram_id}`;
  }

  await notifyAdminsTrialCompleted(admin, {
    studentTelegramId: lesson.telegram_id as number,
    studentName,
    formatLabel,
    teacherName,
    leadId: (lesson.lead_id as string | null) ?? null,
    lessonId,
  });
}
