// UX-слой кабинета преподавателя: рендеры экранов и меню (без БД).
// Запуск: npx tsx scripts/test-teacher-ui.ts

import {
  TEACHER_MENU_LABEL_SET,
  renderTeacherGroupCard,
  renderTeacherGroupList,
  renderTeacherGroupMemberCard,
  renderTeacherGroupMembers,
  renderTeacherIndividualList,
  renderTeacherScheduleHome,
  renderTeacherStudentCard,
  teacherReplyKeyboard,
} from '../src/lib/bot/teacher/teacherFlow';
import type { TeacherBotSnapshot } from '../src/lib/bot/staff/teacher-data';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

type InlineButtonData = Record<string, string>;

function callbacksOf(keyboard: { inline_keyboard: InlineButtonData[][] }): string[] {
  return keyboard.inline_keyboard.flat().map((button) => button.callback_data ?? '');
}

function fixtureSnapshot(): TeacherBotSnapshot {
  const lesson = {
    id: 1,
    kind: 'individual' as const,
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    date: '01.01.2026',
    time: '10:00',
    topic: 'Алгебра',
    status: 'scheduled' as const,
    studentTelegramId: 100,
    studentName: 'Иван Петров',
    groupId: null,
    groupTitle: null,
    meetUrl: null,
    boardUrl: null,
    lessonPlan: null,
    cancelReason: null,
    durationMinutes: 60,
    isUpcoming: true,
  };
  const student = {
    telegramId: 100,
    name: 'Иван Петров',
    phone: null,
    notes: '',
    individualCount: 1,
    groupCount: 0,
    nextLessonAt: lesson.startsAt,
    lessons: [lesson],
    packageCredits: { individual: { remaining: 3, total: 8 }, group: null },
  };
  const group = {
    id: 5,
    title: '10А',
    notes: '',
    members: [{ telegramId: 200, name: 'Мария' }],
    lessons: [],
    nextLessonAt: null,
  };
  return {
    staffName: 'Test',
    nextLesson: lesson,
    currentLesson: null,
    individualLessons: [lesson],
    groupLessons: [],
    allLessons: [lesson],
    students: [student],
    groups: [group],
    daySlots: [],
    pendingHomeworkByStudent: new Map([[100, 2]]),
  };
}

function main(): void {
  console.log('Тест 1: главное меню teacher (Reply Keyboard)');
  {
    const keyboard = teacherReplyKeyboard();
    const labels = keyboard.keyboard.flat().map((button) => button.text);
    check('5 пунктов меню', labels.length === 5);
    check('есть расписание', labels.includes('📅 РАСПИСАНИЕ'));
    check('label-set совпадает', TEACHER_MENU_LABEL_SET.size === 5);
  }

  const snapshot = fixtureSnapshot();

  console.log('Тест 2: расписание');
  {
    const screen = renderTeacherScheduleHome(snapshot);
    check('ближайшее в тексте', screen.text.includes('Алгебра'));
    check('кнопка сегодня', callbacksOf(screen.keyboard).includes('t:sch:today'));
  }

  console.log('Тест 3: индивидуальные ученики');
  {
    const screen = renderTeacherIndividualList(snapshot);
    check('ученик в списке', screen.text.includes('Иван Петров'));
    check('callback карточки', callbacksOf(screen.keyboard).includes('t:st:100'));
  }

  console.log('Тест 4: карточка ученика');
  {
    const screen = renderTeacherStudentCard(snapshot, snapshot.students[0]!);
    check('пакет и ДЗ', screen.text.includes('3/8') && screen.text.includes('2'));
    check('написать', callbacksOf(screen.keyboard).includes('t:msg:w:100'));
  }

  console.log('Тест 5: группы');
  {
    const list = renderTeacherGroupList(snapshot);
    check('группа в списке', list.text.includes('10А'));
    const card = renderTeacherGroupCard(snapshot.groups[0]!);
    check('ученики группы', callbacksOf(card.keyboard).includes('t:gm:5'));
    const members = renderTeacherGroupMembers(snapshot.groups[0]!);
    check('участник', callbacksOf(members.keyboard).includes('t:gs:5:200'));
    const memberCard = renderTeacherGroupMemberCard(snapshot, snapshot.groups[0]!, 200);
    check('карточка участника', memberCard.text.includes('Мария'));
  }

  console.log(`\nИтого: ${passed} ok, ${failed} fail`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
