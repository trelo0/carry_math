import type { SupabaseClient } from '@supabase/supabase-js';
import { sendAdminMessage } from '@/lib/bot/admin/core';
import { assertCuratorCanReachStudent, openStaffStudentDmTopic, staffDmTopicsEnabled } from './dm-topics';
import { getStaffCourseWorkspace } from './staff-course-session';

async function resolveCuratorCourseIdHint(
  admin: SupabaseClient,
  curatorTelegramId: number,
  courseIdHint?: number | null,
): Promise<number | null> {
  if (courseIdHint != null) return courseIdHint;
  const ws = await getStaffCourseWorkspace(admin, curatorTelegramId);
  if (ws?.role === 'curator') return ws.courseId;
  const { resolveCuratorCourseContext } = await import('@/lib/curator/course-context');
  const ctx = await resolveCuratorCourseContext(admin, curatorTelegramId, {});
  return ctx?.courseId ?? null;
}

/** Открыть (или показать) topic куратор ↔ ученик; fallback — wizard в боте. */
export async function openCuratorStudentDmTopicFromBot(
  admin: SupabaseClient,
  curatorTelegramId: number,
  chatId: number,
  studentTelegramId: number,
  courseIdHint?: number | null,
): Promise<void> {
  const courseId = await resolveCuratorCourseIdHint(admin, curatorTelegramId, courseIdHint);

  if (staffDmTopicsEnabled()) {
    try {
      if (courseId != null) {
        await assertCuratorCanReachStudent(
          admin,
          curatorTelegramId,
          studentTelegramId,
          courseId,
        );
      } else {
        await assertCuratorCanReachStudent(admin, curatorTelegramId, studentTelegramId);
      }
    } catch (error) {
      await sendAdminMessage(
        chatId,
        error instanceof Error ? error.message : 'Нет доступа к этому ученику.',
      );
      return;
    }

    const { staffStudentLabel } = await import('./messaging');
    const label = await staffStudentLabel(admin, studentTelegramId);
    const { openStaffDmTopicAndNavigate } = await import('./staff-dm-topic-navigate');
    const opened = await openStaffDmTopicAndNavigate(admin, {
      staffTelegramId: curatorTelegramId,
      studentTelegramId,
      staffRole: 'curator',
      courseIdHint: courseId,
      introText: `✉️ Диалог с ${label}\n\nОтветы пишите в этой теме — ученик получит их в боте.`,
      notifyChatId: chatId,
    });
    if (!opened.ok) {
      await sendAdminMessage(chatId, `❌ ${opened.error ?? 'Не удалось открыть тему.'}`);
    }
    return;
  }

  const { beginCuratorReplyWizard } = await import('@/lib/bot/curator/curatorFlow');
  await beginCuratorReplyWizard(admin, curatorTelegramId, chatId, studentTelegramId);
}

export function curatorCourseMessagesTopicsHint(): string {
  return [
    '💬 Сообщения курса',
    '',
    'Переписка с учениками — в Topics (личный чат с ботом, отдельная тема на ученика).',
    'Новые сообщения приходят в тему автоматически.',
    '',
    'Открыть диалог: «Ученики» → карточка ученика → «Связаться с учеником».',
  ].join('\n');
}

export function checkCourseMessagesTopicsHint(): string {
  return [
    '💬 Сообщения',
    '',
    'Переписка с учениками — в Topics (чат с ботом, тема на каждого ученика).',
    '',
    '«Ученики курса» → карточка → «Связаться с учеником».',
  ].join('\n');
}
