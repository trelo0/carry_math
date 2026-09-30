/**
 * Фазы client-menu без Supabase.
 * npx tsx scripts/test-client-menu-phases.ts
 */
import { buildClientReplyKeyboard, CLIENT_LABELS } from '@/lib/bot/client-menu';
import type { ClientStateSnapshot } from '@/lib/bot/client-state';

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

function base(phase: ClientStateSnapshot['phase'], patch: Partial<ClientStateSnapshot>): ClientStateSnapshot {
  return {
    phase,
    telegramId: 1,
    products: { course: false, individual: false, group: false },
    hasActiveProducts: false,
    hasLessonHistory: false,
    hasUpcomingLessons: false,
    isIdentifiedClient: phase !== 'guest',
    telegramLinked: false,
    hasActiveLessonProduct: false,
    hasActiveCourse: false,
    ...patch,
  };
}

console.log('guest');
{
  const kb = buildClientReplyKeyboard(base('guest', {}));
  const flat = kb.keyboard.flat().map((b) => b.text);
  check('3 кнопки', flat.length === 3);
  check('курс', flat.includes(CLIENT_LABELS.onlineCourse));
}

console.log('client_active course');
{
  const kb = buildClientReplyKeyboard(
    base('client_active', {
      hasActiveProducts: true,
      hasActiveCourse: true,
      products: { course: true, individual: false, group: false },
    }),
  );
  const flat = kb.keyboard.flat().map((b) => b.text);
  check('онлайн-курс', flat.includes(CLIENT_LABELS.onlineCourse));
}

console.log(`\nИтого: ${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
