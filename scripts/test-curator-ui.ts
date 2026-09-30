/**
 * Smoke-тесты экранов куратора (без Supabase).
 * npx tsx scripts/test-curator-ui.ts
 */
import {
  CURATOR_MENU_LABELS,
  curatorReplyKeyboard,
  renderCuratorStudentProfile,
  renderCuratorStudentsList,
} from '@/lib/bot/curator/curatorFlow';
import { renderCuratorHomeworkHub } from '@/lib/bot/staff/curator-homework-screens';
import { renderCuratorActivityHome } from '@/lib/bot/staff/curator-activity-screens';
import type { CuratorStudentRecord } from '@/lib/bot/curator/curatorData';

let ok = 0;
let fail = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    ok++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}

function flatLabels(keyboard: { keyboard?: { text: string }[][] }): string[] {
  return (keyboard.keyboard ?? []).flat().map((b) => b.text);
}

const mockStudent: CuratorStudentRecord = {
  id: '100',
  telegramId: 100,
  name: 'Тест Ученик',
  homeworks: [
    {
      number: 1,
      sanityLessonId: 'lesson-1',
      title: 'Урок 1',
      status: 'submitted',
      submissionFileUrl: null,
      submissionNote: null,
    },
  ],
};

console.log('Тест 1: главное меню куратора');
{
  const labels = flatLabels(curatorReplyKeyboard());
  check('5 пунктов', labels.length === 5);
  check('ученики', labels.includes(CURATOR_MENU_LABELS.students));
  check('курс и прогресс', labels.includes(CURATOR_MENU_LABELS.course));
  check('панель снизу', labels[labels.length - 1] === CURATOR_MENU_LABELS.cabinet);
}

console.log('Тест 2: карточка ученика — написать');
{
  const screen = renderCuratorStudentProfile(mockStudent, 3);
  const callbacks = JSON.stringify(screen.keyboard);
  check('кнопка msg:w', callbacks.includes('c:msg:w:100'));
}

console.log('Тест 3: ДЗ hub');
{
  const screen = renderCuratorHomeworkHub(null);
  check('очереди', JSON.stringify(screen.keyboard).includes('c:hw:q:pending'));
}

console.log('Тест 4: активность');
{
  const screen = renderCuratorActivityHome(
    {
      awaitingReview: 2,
      newQuestions: 1,
      lowLivesCount: 0,
      lowActivityCount: 0,
      liveLine: '🔴 Сейчас в эфире: нет',
      nextLine: '📅 Ближайший урок: —',
      lowLives: [],
      lowActivityStudents: [],
    },
    null,
  );
  check('категории', JSON.stringify(screen.keyboard).includes('c:act:review'));
}

console.log('Тест 5: список учеников');
{
  const screen = renderCuratorStudentsList([mockStudent]);
  check('заголовок', screen.text.includes('МОИ УЧЕНИКИ'));
}

console.log(`\nИтого: ${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
