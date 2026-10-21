import type { SupabaseClient } from '@supabase/supabase-js';
import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { getCuratorCabinetData, type CuratorLessonView } from '@/lib/curator/cabinet-data';
import { syncSessionAfterScheduleSave } from '@/lib/curator/lesson-session';
import {
  isSanityWriteConfigured,
  patchCourseLesson,
} from '@/lib/studio/courseContentWrite';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

export { CURATOR_SCHEDULE_DATETIME_STEP } from './staff-steps';

export type CuratorSchedulePayload = {
  sanityLessonId?: string;
  lessonTitle?: string;
};

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

/** Парсит «ДД.ММ.ГГГГ ЧЧ:ММ» или ISO → ISO UTC + lessonDate YYYY-MM-DD (МСК). */
export function parseCuratorScheduleInput(raw: string): {
  scheduledAtIso: string;
  lessonDate: string;
} | null {
  const text = raw.trim();
  if (!text) return null;

  const isoTry = Date.parse(text);
  if (Number.isFinite(isoTry) && /T|\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(isoTry);
    const lessonDate = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    return { scheduledAtIso: d.toISOString(), lessonDate };
  }

  const m = text.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/,
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hour = m[4] != null ? Number(m[4]) : 18;
  const minute = m[5] != null ? Number(m[5]) : 0;
  if (
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    year < 2020
  ) {
    return null;
  }
  // МСК = UTC+3
  const utcMs = Date.UTC(year, month - 1, day, hour - 3, minute, 0);
  if (!Number.isFinite(utcMs)) return null;
  const d = new Date(utcMs);
  const lessonDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { scheduledAtIso: d.toISOString(), lessonDate };
}

export function renderCuratorScheduleLessonList(
  lessons: CuratorLessonView[],
  nav?: { mainMenuBack?: string },
): { text: string; keyboard: InlineKeyboard } {
  const upcoming = lessons
    .filter((l) => l.sessionStatus !== 'cancelled')
    .sort((a, b) => a.lessonNumber - b.lessonNumber)
    .slice(0, 20);
  const menuBack = nav?.mainMenuBack ?? 'c:home';
  const menuLabel = menuBack.startsWith('s:') ? '⬅️ К расписанию курса' : '⬅️ На главную';

  const lines = [
    '📅 Назначить дату занятия',
    '',
    'Выберите урок — затем отправьте дату сообщением:',
    'формат: ДД.ММ.ГГГГ ЧЧ:ММ (МСК), например 15.10.2026 18:00',
    '',
  ];
  if (upcoming.length === 0) lines.push('Уроков нет.');

  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...upcoming.map((l) => [
          {
            text: `№${l.lessonNumber} · ${l.title}`.slice(0, 60),
            callback_data: `c:sch:pick:${l.sanityId}`,
          },
        ]),
        [backButton(menuLabel, menuBack)],
      ],
    },
  };
}

export function renderCuratorSchedulePrompt(lesson: CuratorLessonView): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const current = lesson.scheduledAt
    ? formatLessonDateTimeRu(lesson.scheduledAt)
    : lesson.lessonDate ?? 'не задана';
  return {
    text: [
      '📅 Дата занятия',
      '',
      `Урок №${lesson.lessonNumber}: ${lesson.title}`,
      `Сейчас: ${current}`,
      '',
      'Отправьте новую дату сообщением:',
      'ДД.ММ.ГГГГ ЧЧ:ММ (МСК)',
      'Пример: 15.10.2026 18:00',
      '',
      'Отмена — «Отмена».',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [backButton('⬅️ К списку уроков', 'c:sch:list')],
        [backButton('⬅️ На главную', 'c:home')],
      ],
    },
  };
}

export async function clearCuratorLessonSchedule(
  admin: SupabaseClient,
  sanityLessonId: string,
): Promise<void> {
  if (!isSanityWriteConfigured()) {
    throw new Error('SANITY_API_WRITE_TOKEN не настроен — дату нельзя сохранить в Sanity.');
  }
  await patchCourseLesson(sanityLessonId, {
    scheduledAt: null,
    lessonDate: null,
  });
}

export async function applyCuratorLessonSchedule(
  admin: SupabaseClient,
  courseId: number,
  sanityLessonId: string,
  scheduledAtIso: string,
  lessonDate: string,
): Promise<void> {
  if (!isSanityWriteConfigured()) {
    throw new Error('SANITY_API_WRITE_TOKEN не настроен — дату нельзя сохранить в Sanity.');
  }
  await patchCourseLesson(sanityLessonId, {
    scheduledAt: scheduledAtIso,
    lessonDate,
  });
  try {
    await syncSessionAfterScheduleSave(admin, courseId, sanityLessonId, scheduledAtIso);
  } catch (error) {
    console.warn('[curator-bot] session sync after schedule failed', error);
  }
}

export async function loadCuratorLessonForSchedule(
  admin: SupabaseClient,
  curatorTelegramId: number,
  sanityLessonId: string,
): Promise<CuratorLessonView | null> {
  const cabinet = await getCuratorCabinetData(admin, curatorTelegramId, null);
  return cabinet.lessons.find((l) => l.sanityId === sanityLessonId) ?? null;
}

export async function listCuratorLessonsForSchedule(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<CuratorLessonView[]> {
  const cabinet = await getCuratorCabinetData(admin, curatorTelegramId, null);
  return cabinet.lessons;
}
