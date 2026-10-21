import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clientBackButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import { listStudentPurchasedVisibleCourseContexts } from './education/student-course-context';
import { formatDateTimeShort } from './client-format';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import { beginStudentSupport } from './studentSupportFlow';
import { listPurchaseRequestsForTelegram } from './purchase-requests';
import {
  listStudentCourseStaffThreads,
  loadStudentCourseStaffMessageHistory,
  loadStudentStaffMessageHistory,
  staffStudentLabel,
} from './staff/messaging';
import { sendLeadMessageAttachment } from './admin/lead-message-media';
import { leadArchiveKindLabel, listClientLeadsForAppealsArchive } from './inquiry-leads';
import { listLeadMessages } from './admin/lead-messages';
import { getStudentOrdinaryTeacherIds } from './education/assignments';
import { loadDismissedAppealKeys, markAppealRead } from './student-appeal-reads';

const appealsIncomingCache = new Map<number, AppealItem[]>();

type AppealItem = {
  key: string;
  title: string;
  preview: string;
  at: string;
  kind: 'course' | 'admin' | 'teacher';
  courseId?: number;
  courseSlug?: string;
  staffTelegramId?: number;
};

async function collectIncomingAppeals(
  admin: SupabaseClient,
  telegramId: number,
): Promise<AppealItem[]> {
  const dismissed = await loadDismissedAppealKeys(admin, telegramId);
  const items: AppealItem[] = [];
  const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);

  for (const course of courses) {
    const { threads } = await listStudentCourseStaffThreads(admin, telegramId, course.courseId);
    for (const t of threads) {
      if (t.lastDirection !== 'staff_to_student') continue;
      const key = `staff:${t.staffRole}:${course.courseId}:${t.staffTelegramId}:${t.lastAt}`;
      if (dismissed.has(key)) continue;
      items.push({
        key,
        title: `Ответ по курсу «${course.title}»`,
        preview: t.lastBody.slice(0, 200),
        at: t.lastAt,
        kind: 'course',
        courseId: course.courseId,
        courseSlug: course.slug,
        staffTelegramId: t.staffTelegramId,
      });
    }
  }

  try {
    const leads = await listPurchaseRequestsForTelegram(admin, telegramId);
    for (const row of leads.filter((r) => r.status === 'pending').slice(0, 5)) {
      const key = `admin:lead:${row.id}`;
      if (dismissed.has(key)) continue;
      items.push({
        key,
        title: 'Заявка администратору',
        preview: row.title,
        at: row.created_at,
        kind: 'admin',
      });
    }
  } catch {
    /* optional table */
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return items;
}

export function isClientAppealsCallback(data: string): boolean {
  return data.startsWith('cl:apl:');
}

export async function showStudentAppealsRoot(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-root',
    '📨 Мои обращения\n\nВходящие — новые ответы. Архив — история по типам.',
    {
      inline_keyboard: [
        [{ text: '📥 Входящие', callback_data: 'cl:apl:in' }],
        [{ text: '📁 Архив', callback_data: 'cl:apl:arch' }],
        [clientBackButton()],
      ],
    },
    deliver,
  );
}

async function showAppealsIncoming(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const items = await collectIncomingAppeals(admin, telegramId);
  appealsIncomingCache.set(telegramId, items);
  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'appeals-in-empty',
      '📥 Входящие\n\nНовых уведомлений нет.',
      {
        inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'cl:apl:root' }]],
      },
      deliver,
    );
    return;
  }

  const lines = ['📥 Входящие', '', 'Выберите уведомление:'];
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const [idx, item] of items.slice(0, 12).entries()) {
    keyboard.push([
      {
        text: `${item.title.slice(0, 40)} · ${formatDateTimeShort(item.at)}`.slice(0, 64),
        callback_data: `cl:apl:open:${idx}`,
      },
    ]);
  }
  keyboard.push([{ text: '◀️ Назад', callback_data: 'cl:apl:root' }]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-in-list',
    lines.join('\n').trim(),
    { inline_keyboard: keyboard },
    deliver,
  );
}

async function showAppealsArchiveMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-arch-menu',
    '📁 Архив обращений',
    {
      inline_keyboard: [
        [{ text: '🛡 Вопросы админу', callback_data: 'cl:apl:arch:admin' }],
        [{ text: '🎓 Вопросы по курсу', callback_data: 'cl:apl:arch:course' }],
        [{ text: '👨‍🏫 Вопросы преподавателю', callback_data: 'cl:apl:arch:teacher' }],
        [{ text: '◀️ Назад', callback_data: 'cl:apl:root' }],
      ],
    },
    deliver,
  );
}

async function showArchiveCoursePick(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-arch-course-pick',
    '🎓 Архив · выберите курс',
    {
      inline_keyboard: [
        ...courses.map((c) => [
          { text: c.title.slice(0, 58), callback_data: `cl:apl:arch:course:${c.courseId}` },
        ]),
        [{ text: '◀️ Назад', callback_data: 'cl:apl:arch' }],
      ],
    },
    deliver,
  );
}

async function showArchiveAdminList(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const leads = await listClientLeadsForAppealsArchive(admin, telegramId);
  if (leads.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'appeals-arch-admin-empty',
      '🛡 Архив · администратор\n\nЗаявок и обращений пока нет.',
      { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'cl:apl:arch' }]] },
      deliver,
    );
    return;
  }
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const l of leads.slice(0, 20)) {
    const snippet = (l.comment ?? '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'без текста';
    const when = formatDateTimeShort(l.created_at);
    keyboard.push([
      {
        text: `🛡 ${when} · ${snippet}`.slice(0, 64),
        callback_data: `cl:apl:lead:${l.id}`,
      },
    ]);
  }
  keyboard.push([{ text: '◀️ Назад', callback_data: 'cl:apl:arch' }]);
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-arch-admin-list',
    '🛡 Архив · администратор\n\nЗаявки и переписка с администрацией:',
    { inline_keyboard: keyboard },
    deliver,
  );
}

async function showArchiveLeadThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  leadId: string,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const leads = await listClientLeadsForAppealsArchive(admin, telegramId, 50);
  const lead = leads.find((l) => l.id === leadId);
  const messages = await listLeadMessages(admin, leadId, { limit: 40 });
  const header = lead
    ? `${leadArchiveKindLabel(lead)} · ${(lead.service ?? 'Обращение').trim()}`
    : '🛡 Обращение администратору';
  const lines = [header, lead?.created_at ? formatDateTimeShort(lead.created_at) : '', '', '💬 Переписка:', ''];
  if (messages.length === 0) {
    lines.push('Сообщений нет.');
  } else {
    for (const m of messages) {
      const who = m.direction === 'client_to_admin' ? '👤 Вы' : '🛡 Администратор';
      const body = m.body?.trim();
      if (body) lines.push(`${who}: ${body}`, '');
    }
  }
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `appeals-lead-${leadId.slice(0, 8)}`,
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [
        [{ text: '✍️ Написать', callback_data: 'cl:misc:admin' }],
        [{ text: '◀️ Назад', callback_data: 'cl:apl:arch:admin' }],
      ],
    },
    deliver,
  );
  for (const m of messages) {
    await sendLeadMessageAttachment(chatId, m);
  }
}

async function showArchiveTeacherPick(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const ids = await getStudentOrdinaryTeacherIds(admin, telegramId);
  if (ids.size === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'appeals-arch-teacher-empty',
      '👨‍🏫 Архив · преподаватель\n\nВопросов преподавателям пока нет.',
      { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'cl:apl:arch' }]] },
      deliver,
    );
    return;
  }
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const id of [...ids]) {
    const name = await staffStudentLabel(admin, id);
    keyboard.push([
      {
        text: `👨‍🏫 ${name}`.slice(0, 58),
        callback_data: `cl:apl:arch:teacher:${id}`,
      },
    ]);
  }
  keyboard.push([{ text: '◀️ Назад', callback_data: 'cl:apl:arch' }]);
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'appeals-arch-teacher-pick',
    '👨‍🏫 Выберите преподавателя:',
    { inline_keyboard: keyboard },
    deliver,
  );
}

async function showArchiveTeacherHistory(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  teacherTelegramId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const { messages, storageEnabled } = await loadStudentStaffMessageHistory(admin, telegramId, {
    staffRole: 'teacher',
    staffTelegramId: teacherTelegramId,
  });
  const teacherName = await staffStudentLabel(admin, teacherTelegramId);
  const lines = [`👨‍🏫 ${teacherName}`, ''];
  if (!storageEnabled || messages.length === 0) {
    lines.push('Сообщений пока нет.');
  } else {
    for (const m of messages) {
      const who = m.direction === 'student_to_staff' ? '👤 Вы' : '👨‍🏫 Преподаватель';
      lines.push(
        `${who} · ${formatDateTimeShort(m.createdAt)}`,
        m.body.trim() || '(без текста)',
        '',
      );
    }
  }
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `appeals-teacher-${teacherTelegramId}`,
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [
        [{ text: '✍️ Написать', callback_data: 'cl:apl:arch:teacher:write' }],
        [{ text: '◀️ Назад', callback_data: 'cl:apl:arch:teacher' }],
      ],
    },
    deliver,
  );
}

async function showArchiveCourseThreadList(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const course = courses.find((c) => c.courseId === courseId);
  const { messages, storageEnabled } = await loadStudentCourseStaffMessageHistory(
    admin,
    telegramId,
    courseId,
    50,
  );
  const lines = [`🎓 ${course?.title ?? 'Курс'}`, storageEnabled ? '💬 Переписка по курсу:' : 'История недоступна.', ''];
  if (messages.length === 0) lines.push('Пока нет сообщений.');
  for (const m of messages) {
    const staff =
      m.staffRole === 'curator' ? 'Куратор' : m.staffRole === 'check' ? 'Проверяющий' : 'Сотрудник';
    const who = m.direction === 'student_to_staff' ? '👤 Вы' : `🎓 ${staff}`;
    lines.push(`${who} · ${formatDateTimeShort(m.createdAt)}`, m.body.trim() || '(без текста)', '');
  }
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `appeals-arch-course-${courseId}`,
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'cl:apl:arch:course' }]],
    },
    deliver,
  );
}

export async function handleClientAppealsCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientAppealsCallback(data)) return false;
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
  const editAt = { chatId, messageId };

  if (data === 'cl:apl:root') {
    await showStudentAppealsRoot(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:apl:in') {
    await showAppealsIncoming(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:apl:arch') {
    await showAppealsArchiveMenu(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:apl:arch:admin') {
    await showArchiveAdminList(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data.startsWith('cl:apl:lead:')) {
    const leadId = data.slice('cl:apl:lead:'.length);
    if (leadId) await showArchiveLeadThread(admin, telegramId, chatId, leadId, { editAt });
    return true;
  }
  if (data === 'cl:apl:arch:course') {
    await showArchiveCoursePick(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data.startsWith('cl:apl:arch:course:')) {
    const courseId = Number(data.split(':')[4]);
    if (Number.isFinite(courseId)) {
      await showArchiveCourseThreadList(admin, telegramId, chatId, courseId, { editAt });
    }
    return true;
  }
  if (data === 'cl:apl:arch:teacher') {
    await showArchiveTeacherPick(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:apl:arch:teacher:write') {
    await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'lessons' });
    return true;
  }
  if (data.startsWith('cl:apl:arch:teacher:') && data !== 'cl:apl:arch:teacher:write') {
    const teacherId = Number(data.split(':')[4]);
    if (Number.isFinite(teacherId)) {
      await showArchiveTeacherHistory(admin, telegramId, chatId, teacherId, { editAt });
    }
    return true;
  }
  if (data.startsWith('cl:apl:write:course:')) {
    const courseId = Number(data.split(':')[4]);
    const slug = (await listStudentPurchasedVisibleCourseContexts(admin, telegramId)).find(
      (c) => c.courseId === courseId,
    )?.slug;
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseId,
      courseSlug: slug,
    });
    return true;
  }
  if (data.startsWith('cl:apl:open:')) {
    const idx = Number(data.slice('cl:apl:open:'.length));
    const items =
      appealsIncomingCache.get(telegramId) ??
      (await collectIncomingAppeals(admin, telegramId));
    const item = items[idx];
    if (!item) {
      await showAppealsIncoming(admin, telegramId, chatId, { editAt });
      return true;
    }
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      `appeal-open:${item.key.slice(0, 40)}`,
      [`📩 ${item.title}`, '', formatDateTimeShort(item.at), '', item.preview].join('\n'),
      {
        inline_keyboard: [
          [{ text: '✅ Прочитано', callback_data: `cl:apl:done:${idx}` }],
          item.kind === 'course' && item.courseId
            ? [
                {
                  text: '✏️ Ответить',
                  callback_data: `cl:apl:write:course:${item.courseId}`,
                },
              ]
            : [{ text: '💬 К администратору', callback_data: 'cl:apl:arch:admin' }],
          [{ text: '◀️ Назад', callback_data: 'cl:apl:in' }],
        ].filter(Boolean) as Array<Array<{ text: string; callback_data: string }>>,
      },
      { editAt },
    );
    return true;
  }
  if (data.startsWith('cl:apl:done:')) {
    const idx = Number(data.slice('cl:apl:done:'.length));
    const items =
      appealsIncomingCache.get(telegramId) ??
      (await collectIncomingAppeals(admin, telegramId));
    const key = items[idx]?.key;
    if (key) await markAppealRead(admin, telegramId, key);
    await showAppealsIncoming(admin, telegramId, chatId, { editAt });
    return true;
  }
  return false;
}
