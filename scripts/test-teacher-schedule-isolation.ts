/**
 * Unit-проверки изоляции расписания (без Supabase).
 * Интеграция с БД: задайте TEACHER_A_TG, TEACHER_B_TG и запустите с --integration
 *
 * npx tsx scripts/test-teacher-schedule-isolation.ts
 * npx tsx scripts/test-teacher-schedule-isolation.ts --integration
 */
import {
  TeacherLessonAccessError,
  assertTeacherOwnsScheduledLesson,
  loadTeacherOwnedLesson,
} from '../src/lib/teacher/lesson-ownership';

async function main() {
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

console.log('Тест 1: TeacherLessonAccessError');
check('instanceof Error', new TeacherLessonAccessError() instanceof Error);

console.log('Тест 2: mock admin — чужое занятие отклоняется');
{
  const teacherA = 1001;
  const teacherB = 1002;
  const lessonId = 42;
  const rows = [{ id: lessonId, teacher_telegram_id: teacherB, status: 'scheduled' }];
  const admin = {
    from() {
      const filters: Record<string, unknown> = {};
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          const row = rows.find(
            (r) =>
              (filters.id == null || r.id === filters.id) &&
              (filters.teacher_telegram_id == null ||
                r.teacher_telegram_id === filters.teacher_telegram_id),
          );
          return { data: row ?? null, error: null };
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof assertTeacherOwnsScheduledLesson>[0];

  let rejected = false;
  try {
    await assertTeacherOwnsScheduledLesson(admin, teacherA, lessonId);
  } catch (e) {
    rejected = e instanceof TeacherLessonAccessError;
  }
  check('assert rejects foreign lesson', rejected);

  const owned = await loadTeacherOwnedLesson(admin, teacherB, lessonId, 'id, status');
  check('load returns row for owner', owned?.id === lessonId);

  const foreign = await loadTeacherOwnedLesson(admin, teacherA, lessonId, 'id');
  check('load null for non-owner', foreign === null);
}

const runIntegration = process.argv.includes('--integration');
if (runIntegration) {
  console.log('\nТест 3: integration (Supabase admin)');
  const teacherA = Number(process.env.TEACHER_A_TG);
  const teacherB = Number(process.env.TEACHER_B_TG);
  if (!teacherA || !teacherB || teacherA === teacherB) {
    console.log('  ⏭ пропуск: задайте TEACHER_A_TG и TEACHER_B_TG');
  } else {
    try {
      const { createAdminClient } = await import('../src/lib/supabase/admin');
      const admin = createAdminClient();
      const { data: lessonB } = await admin
        .from('scheduled_lessons')
        .select('id')
        .eq('teacher_telegram_id', teacherB)
        .eq('status', 'scheduled')
        .limit(1)
        .maybeSingle();
      if (!lessonB?.id) {
        console.log('  ⏭ нет занятия у teacher B');
      } else {
        let blocked = false;
        try {
          await assertTeacherOwnsScheduledLesson(admin, teacherA, lessonB.id as number);
        } catch {
          blocked = true;
        }
        check('A cannot assert own B lesson', blocked);
      }
    } catch (e) {
      console.log('  ⏭ integration error:', e instanceof Error ? e.message : e);
    }
  }
} else {
  console.log('\n(интеграция: --integration + TEACHER_A_TG / TEACHER_B_TG)');
}

console.log(`\nИтого: ${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
