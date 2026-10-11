import type { SupabaseClient } from '@supabase/supabase-js';
import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { getCuratorCabinetData, type CuratorLessonView } from '@/lib/curator/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import { isSanityWriteConfigured } from '@/lib/studio/courseContentWrite';

function lessonLabel(lesson: CuratorLessonView): string {
  return `№${lesson.lessonNumber} · ${lesson.title}`;
}

function whenLabel(lesson: CuratorLessonView): string {
  const iso = lesson.endedAt ?? lesson.scheduledAt ?? lesson.lessonDate;
  if (!iso) return 'дата не указана';
  try {
    return formatLessonDateTimeRu(iso.includes('T') ? iso : `${iso}T18:00:00+03:00`);
  } catch {
    return iso;
  }
}

export async function buildCuratorHomeScreen(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const cabinet = await getCuratorCabinetData(admin, curatorTelegramId, null);
  const last = cabinet.dashboard.lastLesson;
  const next = cabinet.dashboard.nextLesson;
  const canSchedule = isSanityWriteConfigured();

  const lines = [
    '👋 Кабинет куратора',
    cabinet.courseTitle ? `📚 ${cabinet.courseTitle}` : null,
    '',
    last
      ? `⏮ Прошлое занятие: ${lessonLabel(last)}\n   ${whenLabel(last)}`
      : '⏮ Прошлое занятие: пока нет завершённых',
    '',
    next
      ? `⏭ Следующее занятие: ${lessonLabel(next)}\n   ${whenLabel(next)}`
      : '⏭ Следующее занятие: не запланировано',
    '',
    `👨‍🎓 Учеников: ${cabinet.dashboard.studentCount}`,
    `📝 ДЗ на проверке: ${cabinet.dashboard.awaitingReview}`,
    '',
    'Разделы — на кнопках меню ниже.',
  ].filter((x): x is string => x != null);

  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  if (next) {
    keyboard.push([
      {
        text: '📅 Назначить дату следующего',
        callback_data: `c:sch:pick:${next.sanityId}`,
      },
    ]);
  }
  keyboard.push([{ text: '📅 Выбрать занятие для даты', callback_data: 'c:sch:list' }]);
  if (!canSchedule) {
    keyboard.push([{ text: '⚠️ Sanity write не настроен', callback_data: 'noop' }]);
  }
  keyboard.push([{ text: '🎓 Курс и прогресс', callback_data: 'c:act' }]);

  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}
