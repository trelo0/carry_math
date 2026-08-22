// Проверка UX-слоя кабинета преподавателя: рендеры экранов, навигационное
// дерево, целостность MOCK-данных, безопасность (нет контактов).
// Запуск: npx tsx scripts/test-teacher-ui.ts
// БД и Telegram не используются — тестируются чистые функции рендера.

import {
  TEACHER_MENU_LABEL_SET,
  renderCabinet,
  renderGroupCard,
  renderGroupHomework,
  renderGroupHomeworkList,
  renderGroupList,
  renderGroupMemberCard,
  renderGroupMembers,
  renderHomeworkCard,
  renderHomeworkSelect,
  renderIndividualHomework,
  renderIndividualList,
  renderStudentCard,
  teacherReplyKeyboard,
} from '../src/lib/bot/teacher/teacherFlow';
import {
  MOCK_GROUPS,
  MOCK_GROUP_HOMEWORK,
  MOCK_INDIVIDUAL_HOMEWORK,
  MOCK_INDIVIDUAL_STUDENTS,
  getHomeworkSubmission,
  getIndividualHomeworkByStatus,
  getMockGroup,
  getMockGroupHomeworkSummaries,
  getMockGroupMember,
  getMockGroups,
  getMockIndividualStudents,
  getMockStudent,
} from '../src/lib/bot/teacher/mock-data';

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

function main(): void {
  console.log('Тест 1: главное меню teacher (Reply Keyboard)');
  {
    const keyboard = teacherReplyKeyboard();
    const labels = keyboard.keyboard.flat().map((button) => button.text);
    check(
      '4 пункта меню в заданном порядке',
      JSON.stringify(labels) ===
        JSON.stringify([
          '👤 МОИ ИНДИВИДУАЛЬНЫЕ',
          '👥 МОИ МИНИ-ГРУППЫ',
          '📝 ДОМАШНИЕ ЗАДАНИЯ',
          '👤 ЛИЧНЫЙ КАБИНЕТ',
        ]),
    );
    check('label-set совпадает со значениями', TEACHER_MENU_LABEL_SET.size === 4);
    check('клавиатура компактная', keyboard.resize_keyboard === true);
  }

  console.log('Тест 2: мои индивидуальные');
  {
    const screen = renderIndividualList();
    check(
      'все ученики в тексте и кнопках',
      MOCK_INDIVIDUAL_STUDENTS.every(
        (student) => screen.text.includes(student.name) && callbacksOf(screen.keyboard).includes(`t:st:${student.id}`),
      ),
    );
    check('кнопка «Назад» ведёт в меню', callbacksOf(screen.keyboard).includes('t:menu'));
  }

  console.log('Тест 3: карточка ученика');
  {
    const student = getMockStudent('i1');
    check('ученик найден', student !== undefined);
    if (student) {
      const screen = renderStudentCard(student);
      check('формат и статус в тексте', screen.text.includes('индивидуальные занятия') && screen.text.includes('активный'));
      const callbacks = callbacksOf(screen.keyboard);
      check('кнопки ДЗ и сообщения', callbacks.includes('t:shw:i1') && callbacks.includes('t:msg:i1'));
      check('назад к списку', callbacks.includes('t:list:i'));
    }
  }

  console.log('Тест 4: список групп и карточка группы');
  {
    const screen = renderGroupList();
    check(
      'обе группы в кнопках',
      MOCK_GROUPS.every((group) => callbacksOf(screen.keyboard).includes(`t:gr:${group.id}`)),
    );
    const group = getMockGroup('g1');
    check('группа найдена', group !== undefined);
    if (group) {
      const card = renderGroupCard(group);
      check('ученики и статус', card.text.includes('Ученики: 4') && card.text.includes('активная'));
      const callbacks = callbacksOf(card.keyboard);
      check('кнопки «Ученики» и «ДЗ»', callbacks.includes('t:gm:g1') && callbacks.includes('t:ghw:g1'));
    }
  }

  console.log('Тест 5: ученики группы и карточка ученика группы');
  {
    const group = getMockGroup('g1');
    if (group) {
      const members = renderGroupMembers(group);
      check('нумерованный список', members.text.includes('1. Алексей') && members.text.includes('4. Анна'));
      check(
        'имена — inline-кнопки',
        group.members.every((member) => callbacksOf(members.keyboard).includes(`t:gs:g1:${member.id}`)),
      );
      const member = getMockGroupMember('g1', 'm1');
      if (member) {
        const card = renderGroupMemberCard(group, member);
        check(
          'карточка: формат мини-группа и название группы',
          card.text.includes('Формат: мини-группа') && card.text.includes('10А — Математика'),
        );
        check('назад к ученикам группы', callbacksOf(card.keyboard).includes('t:gm:g1'));
      }
    }
  }

  console.log('Тест 6: раздел ДЗ — выбор направления');
  {
    const screen = renderHomeworkSelect();
    const callbacks = callbacksOf(screen.keyboard);
    check('индивидуальные и мини-группы', callbacks.includes('t:hw:i') && callbacks.includes('t:hw:g'));
    check('назад в меню', callbacks.includes('t:menu'));
  }

  console.log('Тест 7: ДЗ индивидуальных');
  {
    const screen = renderIndividualHomework();
    const pending = getIndividualHomeworkByStatus('pending');
    const checkedItems = getIndividualHomeworkByStatus('checked');
    check('счётчик требующих проверки', screen.text.includes(`🔴 Требуют проверки — ${pending.length}`));
    check('счётчик проверенных', screen.text.includes(`🟢 Проверены — ${checkedItems.length}`));
    check('Иван Петров — ДЗ №5', screen.text.includes('Иван Петров — ДЗ №5'));
    check('Алексей Ковалёв — ДЗ №2', screen.text.includes('Алексей Ковалёв — ДЗ №2'));
    check(
      'каждая работа — кнопка',
      [...pending, ...checkedItems].every((item) => callbacksOf(screen.keyboard).includes(`t:hwv:${item.id}`)),
    );
  }

  console.log('Тест 8: ДЗ мини-групп');
  {
    const list = renderGroupHomeworkList();
    const summaries = getMockGroupHomeworkSummaries();
    check(
      'сводки по группам',
      summaries.length === 2 &&
        summaries.some((s) => s.groupId === 'g1' && s.pendingCount === 3) &&
        summaries.some((s) => s.groupId === 'g2' && s.pendingCount === 2),
    );
    check('текст «3 работы»', list.text.includes('3 работы'));
    check('текст «2 работы»', list.text.includes('2 работы'));
    const group = getMockGroup('g1');
    if (group) {
      const groupScreen = renderGroupHomework(group);
      check('работы группы в списке', groupScreen.text.includes('Алексей — ДЗ №4') && groupScreen.text.includes('Требуют проверки: 3'));
      check('проверенная работа не в списке на проверку', !groupScreen.text.includes('Анна'));
    }
  }

  console.log('Тест 9: карточка конкретной работы');
  {
    const submission = getHomeworkSubmission('hi1');
    check('работа найдена', submission !== undefined);
    if (submission) {
      const card = renderHomeworkCard(submission);
      check(
        'все реквизиты работы',
        card.text.includes('Ученик: Иван Петров') &&
          card.text.includes('Задание: №5') &&
          card.text.includes('🔴 Требует проверки') &&
          card.text.includes('📎 Файл ученика'),
      );
      const callbacks = callbacksOf(card.keyboard);
      check(
        '4 действия с ДЗ',
        ['t:hwa:view:hi1', 't:hwa:check:hi1', 't:hwa:comment:hi1', 't:hwa:return:hi1'].every((cb) => callbacks.includes(cb)),
      );
      check('назад к индивидуальным ДЗ', callbacks.includes('t:hw:i'));
    }
    const groupWork = getHomeworkSubmission('hg1-1');
    if (groupWork) {
      const card = renderHomeworkCard(groupWork);
      check('групповая работа: назад к ДЗ групп', callbacksOf(card.keyboard).includes('t:hw:g'));
      check('группа указана', card.text.includes('Группа: 10А — Математика'));
    }
  }

  console.log('Тест 10: личный кабинет');
  {
    const screen = renderCabinet();
    check('без выдуманного URL', !/https?:\/\//.test(screen.text));
    check('подключим позже', screen.text.includes('будет подключена после готовности сайта'));
    check('назад в меню', callbacksOf(screen.keyboard).includes('t:menu'));
  }

  console.log('Тест 11: навигационные маршруты (§15)');
  {
    // Каждое «Назад» ведёт на существующий экран: собираем карту колбэков.
    const known = new Set<string>([
      't:menu', 't:list:i', 't:list:g', 't:hw', 't:hw:i', 't:hw:g',
      ...getMockIndividualStudents().map((s) => `t:st:${s.id}`),
      ...getMockGroups().map((g) => `t:gr:${g.id}`),
      ...getMockGroups().map((g) => `t:gm:${g.id}`),
      ...getMockGroups().map((g) => `t:ghw:${g.id}`),
      ...getMockGroups().flatMap((g) => g.members.map((m) => `t:gs:${g.id}:${m.id}`)),
      ...MOCK_INDIVIDUAL_HOMEWORK.map((h) => `t:hwv:${h.id}`),
      ...MOCK_GROUP_HOMEWORK.map((h) => `t:hwv:${h.id}`),
    ]);
    const allScreens = [
      renderIndividualList(),
      renderGroupList(),
      renderHomeworkSelect(),
      renderIndividualHomework(),
      renderGroupHomeworkList(),
      renderCabinet(),
      ...getMockIndividualStudents().map((s) => renderStudentCard(s)),
      ...getMockGroups().map((g) => renderGroupCard(g)),
      ...getMockGroups().map((g) => renderGroupMembers(g)),
      ...getMockGroups().flatMap((g) => g.members.map((m) => renderGroupMemberCard(g, m))),
      ...getMockGroups().map((g) => renderGroupHomework(g)),
      ...[...MOCK_INDIVIDUAL_HOMEWORK, ...MOCK_GROUP_HOMEWORK].map((h) => renderHomeworkCard(h)),
    ];
    const navigationCallbacks = allScreens
      .flatMap((screen) => callbacksOf(screen.keyboard))
      // Действия, ввод и отмена сообщения проверяются отдельно (роутер вебхука).
      .filter(
        (cb) =>
          !cb.startsWith('t:hwa:') &&
          !cb.startsWith('t:msg') &&
          !cb.startsWith('t:gmsg') &&
          !cb.startsWith('t:shw'),
      );
    check(
      'все переходы указывают на существующие экраны',
      navigationCallbacks.every((cb) => known.has(cb)),
    );

    // Маршруты из §15: последовательности колбэков существуют в карте.
    const routes = [
      ['t:list:i', 't:st:i1', 't:shw:i1', 't:hwv:hi1', 't:hw:i'],
      ['t:list:g', 't:gr:g1', 't:gm:g1', 't:gs:g1:m1', 't:ghw:g1'],
      ['t:hw', 't:hw:i', 't:hwv:hi2'],
      ['t:hw', 't:hw:g', 't:ghw:g1', 't:hwv:hg1-1'],
    ];
    const knownOrSpecial = new Set<string>([...known, 't:shw:i1']);
    check('все 4 маршрута проходимы', routes.every((route) => route.every((cb) => knownOrSpecial.has(cb))));
  }

  console.log('Тест 12: уникальность и лимит callback_data');
  {
    const allScreens = [
      renderIndividualList(),
      renderGroupList(),
      renderHomeworkSelect(),
      renderIndividualHomework(),
      renderGroupHomeworkList(),
      ...getMockIndividualStudents().map((s) => renderStudentCard(s)),
      ...getMockGroups().map((g) => renderGroupCard(g)),
      ...getMockGroups().map((g) => renderGroupMembers(g)),
      ...getMockGroups().flatMap((g) => g.members.map((m) => renderGroupMemberCard(g, m))),
      ...getMockGroups().map((g) => renderGroupHomework(g)),
      ...[...MOCK_INDIVIDUAL_HOMEWORK, ...MOCK_GROUP_HOMEWORK].map((h) => renderHomeworkCard(h)),
    ];
    const callbacks = allScreens.flatMap((screen) => callbacksOf(screen.keyboard));
    check('лимит Telegram 64 байта соблюдён', callbacks.every((cb) => Buffer.byteLength(cb, 'utf8') <= 64));
    const byScreen = allScreens.map((screen) => callbacksOf(screen.keyboard));
    check(
      'в пределах экрана колбэки уникальны',
      byScreen.every((list) => new Set(list).size === list.length),
    );
  }

  console.log('Тест 13: приватность — никаких контактов в экранах');
  {
    const texts = JSON.stringify({
      students: getMockIndividualStudents(),
      groups: getMockGroups(),
      homework: [...MOCK_INDIVIDUAL_HOMEWORK, ...MOCK_GROUP_HOMEWORK],
      screens: [
        renderIndividualList(), renderGroupList(), renderHomeworkSelect(),
        renderIndividualHomework(), renderGroupHomeworkList(), renderCabinet(),
      ].map((s) => s.text),
    });
    // В MOCK-слое допустимы только поля сущностей — без контактов.
    const studentKeys = Object.keys(MOCK_INDIVIDUAL_STUDENTS[0]).join(',');
    const groupKeys = Object.keys(MOCK_GROUPS[0]).join(',');
    check('в учениках нет phone/username/telegram', !/phone|username|telegram/i.test(studentKeys));
    check('в группах нет phone/username/telegram', !/phone|username|telegram/i.test(groupKeys));
    check('нет telegram-ссылок и @username в текстах', !/https?:\/\/t\.me|@\w+/i.test(texts));
    check('нет телефонных номеров в текстах', !/\+\d{9,}|\d{3}[- ]?\d{2}[- ]?\d{2}/.test(texts));
  }

  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

main();
