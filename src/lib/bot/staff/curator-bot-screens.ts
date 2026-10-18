import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { CuratorCabinetData, CuratorLessonView } from '@/lib/curator/cabinet-data';
import type { CuratorStudentView } from '@/lib/curator/students';
import type { CuratorCourseOption } from '@/lib/curator/course-context';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import {
  findLastCompletedLesson,
  findNextLessonNeedingDate,
  findNextProgramLesson,
  studentNextLessonLabel,
} from './curator-bot-lessons';
import { CURATOR_NO_COURSES_TEXT } from './curator-bot-access';

export const CURATOR_BOT_WELCOME_TEXT =
  '👋 Кабинет куратора\n\n' +
  'Все инструменты для работы с курсами — в разделах меню под полем ввода.\n\n' +
  '📅 Расписание курса\n' +
  '📚 Занятия курса\n' +
  '👥 Ученики курса';

function back(text: string, data: string) {
  return { text, callback_data: data };
}

function lessonWhen(lesson: CuratorLessonView): string {
  const iso = lesson.endedAt ?? lesson.scheduledAt ?? lesson.lessonDate;
  if (!iso) return 'дата не назначена';
  try {
    const s = iso.includes('T') ? iso : `${iso}T18:00:00+03:00`;
    return formatLessonDateTimeRu(s);
  } catch {
    return iso;
  }
}

export function renderCuratorCourseHub(): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      '🎓 Курс District\n\n' +
      'Выберите раздел (расписание, занятия или ученики). Для нескольких курсов сначала выберите курс.',
    keyboard: {
      inline_keyboard: [
        [back('📅 Расписание курса', 'c:pk:cal')],
        [back('📚 Занятия курса', 'c:pk:les')],
        [back('👥 Ученики курса', 'c:pk:stu')],
      ],
    },
  };
}

export type CuratorBotSection = 'cal' | 'les' | 'stu';

export function renderCuratorCoursePicker(
  section: CuratorBotSection,
  courses: CuratorCourseOption[],
): { text: string; keyboard: InlineKeyboard } {
  const titles: Record<CuratorBotSection, string> = {
    cal: '📅 Выберите курс — расписание',
    les: '📚 Выберите курс — занятия',
    stu: '👥 Выберите курс — ученики',
  };
  return {
    text: titles[section],
    keyboard: {
      inline_keyboard: [
        ...courses.map((c) => [
          back(c.title.slice(0, 58), `c:${section}:${c.courseId}`),
        ]),
        [back('⬅️ Назад', 'c:hub')],
      ],
    },
  };
}

export function renderCuratorNoCourses(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: CURATOR_NO_COURSES_TEXT,
    keyboard: { inline_keyboard: [[back('⬅️ Главная', 'c:hub')]] },
  };
}

export function renderCuratorScheduleScreen(
  courseTitle: string,
  courseId: number,
  data: CuratorCabinetData,
): { text: string; keyboard: InlineKeyboard } {
  const last = findLastCompletedLesson(data.lessons);
  const next = findNextProgramLesson(data.lessons);
  const needDate = findNextLessonNeedingDate(data.lessons);

  const lines = [
    `📅 Расписание`,
    `🎓 ${courseTitle}`,
    '',
    last
      ? `⏮ Последнее состоявшееся:\n   №${last.lessonNumber} ${last.title}\n   ${lessonWhen(last)}`
      : '⏮ Последнее состоявшееся: пока нет завершённых занятий',
    '',
    next
      ? `⏭ Следующее по программе:\n   №${next.lessonNumber} ${next.title}\n   ${lessonWhen(next)}`
      : '⏭ Следующее по программе: все занятия завершены или отменены',
    '',
  ];

  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  if (needDate) {
    keyboard.push([
      back(
        `📅 Назначить дату следующего (№${needDate.lessonNumber})`,
        `c:sd:${courseId}:${needDate.lessonNumber}`,
      ),
    ]);
  } else {
    lines.push('ℹ️ У всех предстоящих занятий даты уже заданы (или нет занятий без даты).', '');
  }
  keyboard.push([back('📅 Настроить дату любого занятия', `c:cal:${courseId}:any`)]);
  keyboard.push([back('⬅️ К выбору курса', 'c:pk:cal'), back('⬅️ Главная', 'c:hub')]);

  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorScheduleModuleList(
  courseId: number,
  data: CuratorCabinetData,
): { text: string; keyboard: InlineKeyboard } {
  const lines = ['📅 Выберите модуль', `🎓 ${data.courseTitle}`, ''];
  const keyboard: InlineKeyboard['inline_keyboard'] = data.modules.map((mod, idx) => [
    back(`📂 ${mod.title}`.slice(0, 58), `c:cal:${courseId}:m:${idx}`),
  ]);
  keyboard.push([back('⬅️ Назад', `c:cal:${courseId}`)]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorScheduleLessonPick(
  courseId: number,
  moduleIndex: number,
  data: CuratorCabinetData,
): { text: string; keyboard: InlineKeyboard } {
  const mod = data.modules[moduleIndex];
  if (!mod) {
    return {
      text: 'Модуль не найден.',
      keyboard: { inline_keyboard: [[back('⬅️ Назад', `c:cal:${courseId}:any`)]] },
    };
  }
  const lessonById = new Map(data.lessons.map((l) => [l.sanityId, l]));
  const lines = [`📅 ${mod.title}`, 'Выберите занятие:', ''];
  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  for (const sid of mod.lessonIds) {
    const lesson = lessonById.get(sid);
    if (!lesson) continue;
    const cur = lesson.scheduledAt ? lessonWhen(lesson) : 'без даты';
    keyboard.push([
      back(`№${lesson.lessonNumber} · ${cur}`.slice(0, 58), `c:sd:${courseId}:${lesson.lessonNumber}`),
    ]);
  }
  keyboard.push([back('⬅️ К модулям', `c:cal:${courseId}:any`)]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorLessonsModuleList(
  courseId: number,
  data: CuratorCabinetData,
): { text: string; keyboard: InlineKeyboard } {
  const lines = [`📚 ${data.courseTitle}`, 'Выберите модуль:', ''];
  const keyboard: InlineKeyboard['inline_keyboard'] = data.modules.map((mod, idx) => [
    back(`📂 ${mod.title}`.slice(0, 58), `c:les:${courseId}:m:${idx}`),
  ]);
  keyboard.push([back('⬅️ К выбору курса', 'c:pk:les'), back('⬅️ Главная', 'c:hub')]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorLessonsInModule(
  courseId: number,
  moduleIndex: number,
  data: CuratorCabinetData,
): { text: string; keyboard: InlineKeyboard } {
  const mod = data.modules[moduleIndex];
  if (!mod) {
    return {
      text: 'Модуль не найден.',
      keyboard: { inline_keyboard: [[back('⬅️ Назад', `c:les:${courseId}`)]] },
    };
  }
  const lessonById = new Map(data.lessons.map((l) => [l.sanityId, l]));
  const lines = [`📂 ${mod.title}`, ''];
  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  for (const sid of mod.lessonIds) {
    const lesson = lessonById.get(sid);
    if (!lesson) continue;
    keyboard.push([
      back(`№${lesson.lessonNumber} · ${lesson.title}`.slice(0, 58), `c:les:${courseId}:ln:${lesson.lessonNumber}`),
    ]);
  }
  keyboard.push([back('⬅️ К модулям', `c:les:${courseId}`)]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorLessonCard(
  courseId: number,
  lesson: CuratorLessonView,
): { text: string; keyboard: InlineKeyboard } {
  const statusLabels: Record<string, string> = {
    scheduled: 'запланировано',
    waiting: 'ожидание эфира',
    live: 'эфир',
    completed: 'завершено',
    cancelled: 'отменено',
  };
  const lines = [
    `📚 Занятие №${lesson.lessonNumber}`,
    `📂 ${lesson.moduleTitle}`,
    '',
    lesson.title,
    '',
    `📅 ${lessonWhen(lesson)}`,
    `Статус: ${statusLabels[lesson.sessionStatus] ?? lesson.sessionStatus}`,
    '',
    'Материалы и эфир — в кабинете на сайте.',
  ];
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [back('📅 Изменить дату', `c:sd:${courseId}:${lesson.lessonNumber}`)],
        [back('⬅️ К занятиям модуля', `c:les:${courseId}:m:${lesson.moduleIndex}`)],
        [back('⬅️ К модулям', `c:les:${courseId}`)],
      ],
    },
  };
}

export function renderCuratorStudentsList(
  courseId: number,
  courseTitle: string,
  students: CuratorStudentView[],
): { text: string; keyboard: InlineKeyboard } {
  if (students.length === 0) {
    return {
      text: `👥 Ученики\n🎓 ${courseTitle}\n\nНет учеников с активным доступом к курсу.`,
      keyboard: {
        inline_keyboard: [[back('⬅️ Назад', 'c:pk:stu'), back('⬅️ Главная', 'c:hub')]],
      },
    };
  }
  const lines = [`👥 Ученики курса`, `🎓 ${courseTitle}`, `${students.length} чел.`, ''];
  const keyboard: InlineKeyboard['inline_keyboard'] = students.map((s) => [
    back(
      `${s.name} · ${s.progressPercent}%`.slice(0, 58),
      `c:stu:${courseId}:s:${s.telegramId}`,
    ),
  ]);
  keyboard.push([back('⬅️ К выбору курса', 'c:pk:stu'), back('⬅️ Главная', 'c:hub')]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCuratorStudentCard(
  courseTitle: string,
  courseId: number,
  student: CuratorStudentView,
  lessons: CuratorLessonView[],
): { text: string; keyboard: InlineKeyboard } {
  const accessLine = student.fullyBlocked
    ? '🔒 Полная блокировка'
    : student.accessBlocked
      ? '⏸️ Заморожен (0 жизней)'
      : '✅ Активный доступ';
  const lines = [
    `👨‍🎓 ${student.name}`,
    `🎓 ${courseTitle}`,
    '',
    accessLine,
    `📊 Прогресс: ${student.progressPercent}% (${student.completedLessons}/${student.totalLessons})`,
    `💳 Оплаченных занятий: ${student.remainingPaidLessons}`,
    `❤️ Жизни: ${student.livesCurrent ?? '—'}${student.livesMax != null ? `/${student.livesMax}` : ''}`,
    '',
    `⏭ Ближайшее занятие: ${studentNextLessonLabel(lessons, student.completedLessons)}`,
  ];
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [[back('⬅️ К списку', `c:stu:${courseId}`)]],
    },
  };
}

export function renderScheduleDatePrompt(
  courseId: number,
  lesson: CuratorLessonView,
  options?: { confirmCompleted?: boolean },
): { text: string; keyboard: InlineKeyboard } {
  const current = lesson.scheduledAt
    ? lessonWhen(lesson)
    : lesson.lessonDate ?? 'не задана';
  const lines = [
    '📅 Дата и время занятия',
    '',
    `№${lesson.lessonNumber}: ${lesson.title}`,
    `Сейчас: ${current}`,
  ];
  if (options?.confirmCompleted) {
    lines.push('', '⚠️ Занятие уже завершено. Изменение даты — только при необходимости.');
  }
  lines.push(
    '',
    'Отправьте новую дату сообщением:',
    'ДД.ММ.ГГГГ ЧЧ:ММ (МСК)',
    'Пример: 15.10.2026 18:00',
    '',
    'Отмена — «Отмена».',
  );
  const backTarget =
    lesson.sessionStatus === 'completed' && !options?.confirmCompleted
      ? `c:sd:${courseId}:${lesson.lessonNumber}:cfm`
      : `c:cal:${courseId}`;
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [back('⬅️ Отмена', backTarget)],
        [back('⬅️ Расписание', `c:cal:${courseId}`)],
      ],
    },
  };
}

export function renderCompletedDateConfirm(
  courseId: number,
  lessonNumber: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      '⚠️ Это занятие уже завершено.\n\n' +
      'Изменить дату всё равно? Это не отменяет проведённый эфир, только календарь в Sanity.',
    keyboard: {
      inline_keyboard: [
        [back('✅ Да, изменить дату', `c:sd:${courseId}:${lessonNumber}:go`)],
        [back('⬅️ Нет', `c:cal:${courseId}`)],
      ],
    },
  };
}
