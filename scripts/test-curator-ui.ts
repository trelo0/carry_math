// Проверка UX-слоя кабинета ментора: рендеры экранов, расчёт статусов,
// mock-мутации (одобрение/отклонение), уведомления, навигационное дерево.
// Запуск: npx tsx scripts/test-curator-ui.ts
// БД и Telegram не используются — тестируются чистые функции и mock state.

import {
  CURATOR_MENU_LABEL_SET,
  curatorReplyKeyboard,
  renderCuratorCabinet,
  renderCuratorHomeworkCard,
  renderCuratorLibrary,
  renderCuratorLibraryFile,
  renderCuratorLibraryTask,
  renderCuratorNotificationView,
  renderCuratorNotifications,
  renderCuratorPreLesson,
  renderCuratorRejectMethod,
  renderCuratorStudentProfile,
  renderCuratorStudentsList,
  renderCuratorWebinar,
} from '../src/lib/bot/curator/curatorFlow';
import { CURATOR_LIBRARY } from '../src/lib/bot/curator/mock-data';
import {
  getCuratorHomework,
  getCuratorHomeworkComment,
  getCuratorNewSubmissions,
  getCuratorStudent,
  getCuratorStudentListLabel,
  getCuratorStudentSummary,
  getCuratorStudents,
  getCuratorUnreadCount,
  isCuratorNotificationRead,
  markCuratorNotificationRead,
  resetCuratorMockState,
  setCuratorHomeworkStatus,
} from '../src/lib/bot/curator/mock-state';

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
  resetCuratorMockState();

  console.log('Тест 1: главное меню ментора (Reply Keyboard)');
  {
    const keyboard = curatorReplyKeyboard();
    const labels = keyboard.keyboard.flat().map((button) => button.text);
    check(
      '4 пункта меню в заданном порядке',
      JSON.stringify(labels) ===
        JSON.stringify(['📝 ДОМАШКИ', '👨‍🎓 УЧЕНИКИ', '🔔 УВЕДОМЛЕНИЯ', '👤 ЛИЧНЫЙ КАБИНЕТ']),
    );
    check('label-set совпадает', CURATOR_MENU_LABEL_SET.size === 4);
  }

  console.log('Тест 2: библиотека домашних заданий');
  {
    const library = renderCuratorLibrary();
    check('курс и 3 вебинара', library.text.includes('📚 Курс') && library.text.includes('📂 Вебинар 3'));
    check('вебинары — кнопки', ['c:libw:w1', 'c:libw:w2', 'c:libw:w3'].every((cb) => callbacksOf(library.keyboard).includes(cb)));
    const webinar = renderCuratorWebinar('w2');
    check('внутри вебинара 3 задания', webinar !== null && webinar.text.split('📄').length === 4);
    check('назад к библиотеке', webinar !== null && callbacksOf(webinar.keyboard).includes('c:lib'));
  }

  console.log('Тест 3: просмотр задания библиотеки');
  {
    const task = renderCuratorLibraryTask('w2t2');
    check('задание найдено', task !== null);
    if (task) {
      check('условие задания в тексте', task.text.includes('Условие задания:') && task.text.includes('📎 Файл с условием'));
      check('назад к вебинару', callbacksOf(task.keyboard).includes('c:libw:w2'));
      const file = renderCuratorLibraryFile('w2t2');
      check('файл — заглушка без реальной загрузки', file !== null && file.text.includes('В реальной версии здесь будет файл задания.'));
    }
  }

  console.log('Тест 4: список учеников и автоматический статус');
  {
    const students = getCuratorStudents();
    check('5 тестовых учеников', students.length === 5);
    const labels = students.map((s) => getCuratorStudentListLabel(s));
    check('Иван Петров — 🔴 2 долга (расчёт из ДЗ)', labels.includes('🔴 Иван Петров — 2 долга'));
    check('Анна Смирнова — 🔴 1 долг', labels.includes('🔴 Анна Смирнова — 1 долг'));
    check('Алексей Ковалёв — 🟡 1 ДЗ на проверке', labels.includes('🟡 Алексей Ковалёв — 1 ДЗ на проверке'));
    check('Дмитрий Волков — 🟢 без suffix', labels.includes('🟢 Дмитрий Волков'));
    const ivan = getCuratorStudent('s1');
    check('статус не хранится, а считается', ivan !== undefined && getCuratorStudentSummary(ivan).debtCount === 2);
  }

  console.log('Тест 5: профиль ученика');
  {
    const profile = renderCuratorStudentProfile('s1');
    check('профиль найден', profile !== null);
    if (profile) {
      check('жизни на Арене — заглушка «—»', profile.text.includes('❤️ Жизни на Арене: —'));
      check('задолженность рассчитана', profile.text.includes('🔴 Задолженность: 2 ДЗ'));
      check('несданные перечислены', profile.text.includes('• ДЗ №2') && profile.text.includes('• ДЗ №5'));
      check('каждое ДЗ — inline-кнопка', callbacksOf(profile.keyboard).includes('c:shw:s1:3'));
      check('назад к списку учеников', callbacksOf(profile.keyboard).includes('c:stud'));
    }
    const clean = renderCuratorStudentProfile('s5');
    check('у ученика без долгов — «Задолженностей нет»', clean !== null && clean.text.includes('🟢 Задолженностей нет'));
  }

  console.log('Тест 6: карточка ДЗ ученика');
  {
    const card = renderCuratorHomeworkCard('s1', 3);
    check('карточка найдена', card !== null);
    if (card) {
      check(
        'реквизиты работы',
        card.text.includes('Ученик: Иван Петров') &&
          card.text.includes('Задание: ДЗ №3') &&
          card.text.includes('🔄 На доработке') &&
          card.text.includes('📎 Работа ученика'),
      );
      const callbacks = callbacksOf(card.keyboard);
      check('одобрить/отклонить/посмотреть', ['c:appr:s1:3', 'c:rej:s1:3', 'c:vieww:s1:3'].every((cb) => callbacks.includes(cb)));
      check('назад к профилю', callbacks.includes('c:sp:s1'));
    }
  }

  console.log('Тест 7: одобрение меняет только mock state');
  {
    check('перед одобрением статус revision', getCuratorHomework('s1', 3)?.status === 'revision');
    const changed = setCuratorHomeworkStatus('s1', 3, 'approved');
    check('одобрение применилось', changed === true);
    check('статус в mock state стал approved', getCuratorHomework('s1', 3)?.status === 'approved');
    const profile = renderCuratorStudentProfile('s1');
    // Список ДЗ в профиле — inline-кнопки: новый статус виден на кнопке.
    const hwButton = profile?.keyboard.inline_keyboard.flat().find((b) => b.text.includes('ДЗ №3'));
    check('профиль показывает новый статус', hwButton?.text.includes('ДЗ №3 — одобрено') === true);
    // возврат исходного состояния для следующих тестов
    setCuratorHomeworkStatus('s1', 3, 'revision');
  }

  console.log('Тест 8: отклонение — выбор способа комментария');
  {
    const screen = renderCuratorRejectMethod('s1', 3);
    check('текст в соответствии со спецификацией', screen.text.includes('Выберите способ отправки комментария'));
    const callbacks = callbacksOf(screen.keyboard);
    check(
      'все способы + без комментария + отмена',
      ['c:rejt:s1:3', 'c:rejv:s1:3', 'c:rejp:s1:3', 'c:rejskip:s1:3', 'c:rejc:s1:3'].every((cb) => callbacks.includes(cb)),
    );
  }

  console.log('Тест 9: текстовый комментарий при отклонении');
  {
    const comment = 'Проверь решение задания №3 и исправь ошибку в последнем пункте.';
    setCuratorHomeworkStatus('s1', 3, 'rejected', comment);
    check('статус стал rejected', getCuratorHomework('s1', 3)?.status === 'rejected');
    check('комментарий сохранён в mock state', getCuratorHomeworkComment('s1', 3) === comment);
    setCuratorHomeworkStatus('s1', 3, 'revision');
  }

  console.log('Тест 10: уведомления о новых ДЗ');
  {
    const notifications = getCuratorNewSubmissions();
    check('3 новые отправки (submitted)', notifications.length === 3);
    check('unread = 3 до прочтения', getCuratorUnreadCount() === 3);
    const screen = renderCuratorNotifications();
    check('счётчик в заголовке', screen.text.includes('🔴 Новые домашние задания — 3'));
    check('Иван Петров отправил ДЗ №4', screen.text.includes('Иван Петров') && screen.text.includes('ДЗ №4'));
    check('Мария — женское окончание «Отправила»', screen.text.includes('Отправила ДЗ №3'));
    check('каждое уведомление — кнопка', callbacksOf(screen.keyboard).includes('c:notv:s1:4'));
    check('кнопка контроля перед занятием', callbacksOf(screen.keyboard).includes('c:pre'));
  }

  console.log('Тест 11: отметка уведомления прочитанным');
  {
    const view = renderCuratorNotificationView('s1:4');
    check('экран уведомления', view !== null && view.text.includes('🟡 Ожидает проверки'));
    check('кнопка «Открыть ДЗ»', view !== null && callbacksOf(view.keyboard).includes('c:shw:s1:4'));
    check('уведомление отмечено прочитанным при открытии', isCuratorNotificationRead('s1:4') === true);
    check('unread уменьшился', getCuratorUnreadCount() === 2);
    const list = renderCuratorNotifications();
    check('прочитанное не в блоке новых', !list.text.split('🔴 Новые домашние задания')[1]?.includes('Иван Петров'));
    check('прочитанное остаётся доступным с отметкой ✓', callbacksOf(list.keyboard).includes('c:notv:s1:4'));
    markCuratorNotificationRead('s2:3');
    markCuratorNotificationRead('s3:5');
    check('после прочтения всех — 0 новых', getCuratorUnreadCount() === 0);
    const empty = renderCuratorNotifications();
    check('сообщение «Новых домашних заданий нет»', empty.text.includes('Новых домашних заданий нет.'));
  }

  console.log('Тест 12: контроль перед занятием (mock-экран)');
  {
    const screen = renderCuratorPreLesson();
    check('сводка по спецификации', screen.text.includes('Не сдали ДЗ: 7 учеников') && screen.text.includes('ДЗ ожидают проверки: 4') && screen.text.includes('На доработке: 3'));
    const callbacks = callbacksOf(screen.keyboard);
    check('кнопки «должники» и «проверить ДЗ»', callbacks.includes('c:stud') && callbacks.includes('c:notif'));
    check('назад к уведомлениям', callbacks.includes('c:notif'));
  }

  console.log('Тест 13: личный кабинет');
  {
    const screen = renderCuratorCabinet();
    check('без выдуманного URL', !/https?:\/\//.test(screen.text));
    check('подключим позже', screen.text.includes('будет подключена после готовности сайта'));
  }

  console.log('Тест 14: навигационные маршруты (§18)');
  {
    const allScreens: Array<{ text: string; keyboard: InlineKeyboardLike }> = [
      renderCuratorLibrary(),
      renderCuratorStudentsList(),
      renderCuratorNotifications(),
      renderCuratorPreLesson(),
      renderCuratorCabinet(),
    ];
    for (const w of CURATOR_LIBRARY) {
      const webinar = renderCuratorWebinar(w.id);
      if (webinar) allScreens.push(webinar);
      for (const task of w.tasks) {
        const taskScreen = renderCuratorLibraryTask(task.id);
        if (taskScreen) allScreens.push(taskScreen);
        const fileScreen = renderCuratorLibraryFile(task.id);
        if (fileScreen) allScreens.push(fileScreen);
      }
    }
    for (const student of getCuratorStudents()) {
      const profile = renderCuratorStudentProfile(student.id);
      if (profile) allScreens.push(profile);
      for (const hw of student.homeworks) {
        const card = renderCuratorHomeworkCard(student.id, hw.number);
        if (card) allScreens.push(card);
        allScreens.push(renderCuratorRejectMethod(student.id, hw.number));
      }
    }

    const known = new Set<string>([
      'c:menu', 'c:lib', 'c:stud', 'c:notif', 'c:pre',
      ...CURATOR_LIBRARY.map((w) => `c:libw:${w.id}`),
      ...CURATOR_LIBRARY.flatMap((w) => w.tasks.map((t) => `c:libv:${t.id}`)),
      ...CURATOR_LIBRARY.flatMap((w) => w.tasks.map((t) => `c:libf:${t.id}`)),
      ...getCuratorStudents().map((s) => `c:sp:${s.id}`),
      ...getCuratorStudents().flatMap((s) => s.homeworks.map((h) => `c:shw:${s.id}:${h.number}`)),
    ]);
    // Служебные действия (одобрение/отклонение/вложения) обрабатывает роутер.
    const navigationCallbacks = allScreens
      .flatMap((screen) => callbacksOf(screen.keyboard as { inline_keyboard: InlineButtonData[][] }))
      .filter((cb) => !/^c:(appr|rej|vieww|notv)/.test(cb));
    check('все переходы указывают на существующие экраны', navigationCallbacks.every((cb) => known.has(cb)));

    const routes = [
      ['c:lib', 'c:libw:w2', 'c:libv:w2t2', 'c:libf:w2t2'],
      ['c:stud', 'c:sp:s1', 'c:shw:s1:3', 'c:appr:s1:3'],
      ['c:stud', 'c:sp:s1', 'c:shw:s1:3', 'c:rej:s1:3', 'c:rejt:s1:3'],
      ['c:notif', 'c:notv:s1:4', 'c:shw:s1:4'],
    ];
    const knownOrAction = new Set<string>([...known, 'c:appr:s1:3', 'c:rej:s1:3', 'c:rejt:s1:3', 'c:notv:s1:4']);
    check('все 4 маршрута проходимы', routes.every((route) => route.every((cb) => knownOrAction.has(cb))));

    check(
      'лимит Telegram 64 байта соблюдён',
      allScreens
        .flatMap((screen) => callbacksOf(screen.keyboard as { inline_keyboard: InlineButtonData[][] }))
        .every((cb) => Buffer.byteLength(cb, 'utf8') <= 64),
    );
  }

  console.log('Тест 15: приватность и изоляция');
  {
    const dump = JSON.stringify({ students: getCuratorStudents(), library: CURATOR_LIBRARY });
    const studentKeys = Object.keys(getCuratorStudents()[0]).join(',');
    check('в учениках нет phone/username/telegram', !/phone|username|telegram/i.test(studentKeys));
    check('нет telegram-ссылок и @username', !/https?:\/\/t\.me|@\w+/i.test(dump));
    check('сброс mock state восстанавливает seed', (() => {
      setCuratorHomeworkStatus('s5', 1, 'rejected');
      resetCuratorMockState();
      return getCuratorHomework('s5', 1)?.status === 'approved';
    })());
  }

  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

type InlineKeyboardLike = { inline_keyboard: InlineButtonData[][] };

main();
