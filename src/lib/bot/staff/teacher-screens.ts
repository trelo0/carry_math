import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { TeacherGroupView, TeacherLessonView, TeacherStudentView } from '@/lib/teacher/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import {
  formatPackageLine,
  lessonKindLabel,
  lessonsToday,
  lessonsUpcoming,
  lessonStatusLabel,
  lessonTitleLine,
  studentDisplayName,
  type TeacherBotSnapshot,
} from './teacher-data';
import type { StaffScreenNav } from './staff-screen-nav';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

function notFoundKeyboard(backText: string, backCallback: string): InlineKeyboard {
  return { inline_keyboard: [[backButton(`⬅️ ${backText}`, backCallback)]] };
}

export function renderTeacherScheduleHome(
  snapshot: TeacherBotSnapshot,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const today = lessonsToday(snapshot.allLessons.filter((l) => l.status !== 'cancelled'));
  const upcoming = lessonsUpcoming(snapshot.allLessons);
  const parts = ['📅 РАСПИСАНИЕ ЗАНЯТИЙ', ''];
  const menuBack = nav?.mainMenuBack ?? 't:menu';
  const menuLabel = menuBack.startsWith('s:sch') ? '⬅️ К расписанию' : '⬅️ Главное меню';

  if (snapshot.currentLesson) {
    parts.push('🟢 Сейчас:', lessonTitleLine(snapshot.currentLesson), '');
  } else if (snapshot.nextLesson) {
    parts.push('⏭ Ближайшее:', lessonTitleLine(snapshot.nextLesson), '');
  } else {
    parts.push('Ближайших занятий нет.', '');
  }

  parts.push(`📆 Сегодня: ${today.length}`, `📋 Предстоящие: ${upcoming.length}`);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...(snapshot.nextLesson && !snapshot.currentLesson
          ? [[backButton('⏭ Ближайшее занятие', `t:les:${snapshot.nextLesson.id}`)]]
          : []),
        ...(snapshot.currentLesson
          ? [[backButton('🟢 Текущее занятие', `t:les:${snapshot.currentLesson.id}`)]]
          : []),
        [{ text: '📆 Занятия на сегодня', callback_data: 't:sch:today' }],
        [{ text: '📋 Предстоящие', callback_data: 't:sch:up' }],
        [backButton(menuLabel, menuBack)],
      ],
    },
  };
}

export function renderTeacherScheduleToday(snapshot: TeacherBotSnapshot): { text: string; keyboard: InlineKeyboard } {
  const today = lessonsToday(snapshot.allLessons.filter((l) => l.status !== 'cancelled'));
  const parts = ['📆 СЕГОДНЯ', ''];
  if (today.length === 0) {
    parts.push('На сегодня занятий нет.');
  } else {
    parts.push(...today.map((l) => `• ${lessonTitleLine(l)}`));
  }
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...today.map((l) => [
          {
            text: `${l.time} · ${l.topic}`.slice(0, 60),
            callback_data: `t:les:${l.id}`,
          },
        ]),
        [backButton('⬅️ Расписание', 't:sch')],
      ],
    },
  };
}

export function renderTeacherScheduleUpcoming(snapshot: TeacherBotSnapshot): { text: string; keyboard: InlineKeyboard } {
  const upcoming = lessonsUpcoming(snapshot.allLessons);
  const parts = ['📋 ПРЕДСТОЯЩИЕ', ''];
  if (upcoming.length === 0) {
    parts.push('Предстоящих занятий нет.');
  } else {
    parts.push(...upcoming.map((l) => `• ${lessonTitleLine(l)}`));
  }
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...upcoming.map((l) => [{ text: `${l.date} ${l.time} — ${l.topic}`.slice(0, 60), callback_data: `t:les:${l.id}` }]),
        [backButton('⬅️ Расписание', 't:sch')],
      ],
    },
  };
}

export function renderTeacherLessonCard(
  snapshot: TeacherBotSnapshot,
  lesson: TeacherLessonView,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [
    `📚 ${lesson.topic}`,
    '',
    `Формат: ${lessonKindLabel(lesson.kind)}`,
    `Дата: ${formatLessonDateTimeRu(lesson.startsAt)}`,
    `Статус: ${lessonStatusLabel(lesson.status)}`,
  ];
  if (lesson.kind === 'individual' && lesson.studentName) {
    parts.push(`Ученик: ${lesson.studentName}`);
  }
  if (lesson.groupTitle) parts.push(`Группа: ${lesson.groupTitle}`);

  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  if (lesson.studentTelegramId) {
    keyboard.push([backButton('👤 Карточка ученика', `t:st:${lesson.studentTelegramId}`)]);
    keyboard.push([backButton('💬 Написать ученику', `t:msg:w:${lesson.studentTelegramId}`)]);
  }
  if (lesson.groupId) {
    keyboard.push([backButton('👥 Группа', `t:gr:${lesson.groupId}`)]);
  }
  keyboard.push([backButton('⬅️ Расписание', 't:sch')]);

  return { text: parts.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

function countIndividualStudents(snapshot: TeacherBotSnapshot): number {
  return snapshot.students.filter(
    (s) => s.individualCount > 0 || s.lessons.some((l) => l.kind === 'individual'),
  ).length;
}

export function renderTeacherStudentsHub(
  snapshot?: TeacherBotSnapshot,
): { text: string; keyboard: InlineKeyboard } {
  const ind = snapshot ? countIndividualStudents(snapshot) : null;
  const groups = snapshot ? snapshot.groups.length : null;
  const lines = ['👥 МОИ УЧЕНИКИ', ''];
  if (ind != null && groups != null) {
    lines.push(`👤 Индивидуальные: ${ind}`, `👥 Мини-группы: ${groups}`, '');
    if (ind === 0 && groups === 0) {
      lines.push(
        'Пока нет учеников.',
        'Они появятся после назначения вам ученика или создания занятия/группы.',
        '',
      );
    }
  }
  lines.push('Выберите раздел:');

  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          {
            text: ind != null ? `👤 Индивидуальные (${ind})` : '👤 Индивидуальные',
            callback_data: 't:stu:i',
          },
        ],
        [
          {
            text: groups != null ? `👥 Мини-группы (${groups})` : '👥 Мини-группы',
            callback_data: 't:stu:g',
          },
        ],
        [backButton('⬅️ Главное меню', 't:menu')],
      ],
    },
  };
}

export function renderTeacherIndividualList(
  snapshot: TeacherBotSnapshot,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const back = nav?.listBack ?? 't:stu';
  const students = snapshot.students
    .filter((s) => s.individualCount > 0 || s.lessons.some((l) => l.kind === 'individual'))
    .sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b), 'ru'));

  if (students.length === 0) {
    return {
      text:
        '👤 ИНДИВИДУАЛЬНЫЕ\n\n' +
        'Пока нет индивидуальных учеников.\n' +
        'Нужно активное назначение вам как преподавателю или индивидуальное занятие в расписании.',
      keyboard: { inline_keyboard: [[backButton('⬅️ Назад', back)]] },
    };
  }

  return {
    text: `👤 ИНДИВИДУАЛЬНЫЕ\n\n${students.map((s) => studentDisplayName(s)).join('\n')}`,
    keyboard: {
      inline_keyboard: [
        ...students.map((s) => [{ text: studentDisplayName(s), callback_data: `t:st:${s.telegramId}` }]),
        [backButton('⬅️ Назад', back)],
      ],
    },
  };
}

export function renderTeacherGroupList(
  snapshot: TeacherBotSnapshot,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const back = nav?.listBack ?? 't:stu';
  const groups = snapshot.groups;
  if (groups.length === 0) {
    return {
      text: '👥 МИНИ-ГРУППЫ\n\nПока нет активных групп.',
      keyboard: { inline_keyboard: [[backButton('⬅️ Назад', back)]] },
    };
  }
  return {
    text: `👥 МИНИ-ГРУППЫ\n\n${groups.map((g) => g.title).join('\n')}`,
    keyboard: {
      inline_keyboard: [
        ...groups.map((g) => [{ text: g.title, callback_data: `t:gr:${g.id}` }]),
        [backButton('⬅️ Назад', back)],
      ],
    },
  };
}

export function renderTeacherStudentCard(
  snapshot: TeacherBotSnapshot,
  student: TeacherStudentView,
): { text: string; keyboard: InlineKeyboard } {
  const pending = snapshot.pendingHomeworkByStudent.get(student.telegramId) ?? 0;
  const pkg = formatPackageLine(student);
  const next =
    student.nextLessonAt != null ? formatLessonDateTimeRu(student.nextLessonAt) : '—';
  const nowMs = Date.now();
  const upcomingWithStudent = student.lessons
    .filter(
      (l) =>
        l.status === 'scheduled' &&
        new Date(l.startsAt).getTime() >= nowMs - 60_000,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5);

  const parts = [
    `👤 ${studentDisplayName(student)}`,
    '',
    `Осталось занятий: ${pkg ?? 'нет активного пакета'}`,
    `Ближайшее занятие: ${next}`,
    `Домашних на проверке: ${pending}`,
  ];
  if (student.phone?.trim()) {
    parts.push(`☎️ ${student.phone.trim()}`);
  }
  if (upcomingWithStudent.length > 0) {
    parts.push('', 'Занятия с учеником:');
    for (const l of upcomingWithStudent) {
      parts.push(`• ${formatLessonDateTimeRu(l.startsAt)} — ${l.topic}`);
    }
  } else {
    parts.push('', 'Ближайших занятий с учеником нет.');
  }

  const keyboard: InlineKeyboard['inline_keyboard'] = [
    [{ text: '💬 Написать в боте', callback_data: `t:msg:w:${student.telegramId}` }],
    [{ text: '📲 Открыть в Telegram', url: `tg://user?id=${student.telegramId}` }],
  ];
  if (pending > 0) {
    keyboard.push([{ text: '📝 ДЗ на проверке', callback_data: 't:hw:q:pending' }]);
  }
  if (upcomingWithStudent[0]) {
    keyboard.push([
      {
        text: '⏭ Ближайшее занятие',
        callback_data: `t:les:${upcomingWithStudent[0].id}`,
      },
    ]);
  }
  keyboard.push([backButton('⬅️ Назад', 't:stu:i')]);

  return {
    text: parts.join('\n'),
    keyboard: { inline_keyboard: keyboard },
  };
}

export function renderTeacherGroupCard(group: TeacherGroupView): { text: string; keyboard: InlineKeyboard } {
  const next = group.nextLessonAt ? formatLessonDateTimeRu(group.nextLessonAt) : '—';
  const text = [
    `👥 ${group.title}`,
    '',
    `Участников: ${group.members.length}`,
    `Ближайшее занятие: ${next}`,
  ].join('\n');
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '👤 Ученики', callback_data: `t:gm:${group.id}` }],
        [{ text: '📝 Домашние задания', callback_data: 't:hw' }],
        [backButton('⬅️ Назад', 't:stu:g')],
      ],
    },
  };
}

export function renderTeacherGroupMembers(group: TeacherGroupView): { text: string; keyboard: InlineKeyboard } {
  const list = group.members.map((m, i) => `${i + 1}. ${m.name ?? `ID ${m.telegramId}`}`).join('\n');
  return {
    text: `👥 ${group.title}\n\n${list}`,
    keyboard: {
      inline_keyboard: [
        ...group.members.map((m) => [
          { text: m.name ?? `Ученик ${m.telegramId}`, callback_data: `t:gs:${group.id}:${m.telegramId}` },
        ]),
        [backButton('⬅️ Назад', `t:gr:${group.id}`)],
      ],
    },
  };
}

export function renderTeacherGroupMemberCard(
  snapshot: TeacherBotSnapshot,
  group: TeacherGroupView,
  memberTelegramId: number,
): { text: string; keyboard: InlineKeyboard } {
  const student = snapshot.students.find((s) => s.telegramId === memberTelegramId);
  const name =
    group.members.find((m) => m.telegramId === memberTelegramId)?.name ??
    student?.name ??
    `Ученик ${memberTelegramId}`;
  const pending = snapshot.pendingHomeworkByStudent.get(memberTelegramId) ?? 0;
  const pkg = student ? formatPackageLine(student) : null;
  const next =
    student?.nextLessonAt != null ? formatLessonDateTimeRu(student.nextLessonAt) : '—';

  const text = [
    `👤 ${name}`,
    '',
    `Группа: ${group.title}`,
    `Осталось занятий: ${pkg ?? 'нет активного пакета'}`,
    `Ближайшее занятие: ${next}`,
    `Домашних на проверке: ${pending}`,
  ].join('\n');

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '💬 Написать в боте', callback_data: `t:msg:w:${memberTelegramId}` }],
        [{ text: '📲 Открыть в Telegram', url: `tg://user?id=${memberTelegramId}` }],
        [backButton('⬅️ Назад', `t:gm:${group.id}`)],
      ],
    },
  };
}

export function renderTeacherSectionStub(section: string): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${section}\n\nРаздел подключается на следующем этапе реализации.`,
    keyboard: { inline_keyboard: [[backButton('⬅️ Главное меню', 't:menu')]] },
  };
}

export { notFoundKeyboard };
