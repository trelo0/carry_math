/**
 * Логика суммы пакетов по course_id (без БД).
 * npx tsx scripts/test-multicourse-entitlement.ts
 */

type Pkg = { total_lessons: number; course_id: number | null };

function sumEntitlement(rows: Pkg[], courseId: number): number {
  return rows
    .filter((row) => row.course_id == null || row.course_id === courseId)
    .reduce((s, row) => s + row.total_lessons, 0);
}

const rows: Pkg[] = [
  { total_lessons: 10, course_id: 1 },
  { total_lessons: 8, course_id: 2 },
];

if (sumEntitlement(rows, 1) !== 10) throw new Error('course 1');
if (sumEntitlement(rows, 2) !== 8) throw new Error('course 2');
console.log('test-multicourse-entitlement: ok');
