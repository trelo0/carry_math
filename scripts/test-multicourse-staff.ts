/**
 * Smoke: логика мультикурса (без Supabase).
 * npx tsx scripts/test-multicourse-staff.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Имитация: один ученик — два course_id, разные кураторы. */
function mentorKey(telegramId: number, kind: string, mentorId: number, courseId: number | null) {
  return `${telegramId}:${kind}:${mentorId}:${courseId ?? 0}`;
}

const store = new Set<string>();

function assignCurator(
  studentId: number,
  curatorId: number,
  courseId: number | null,
): void {
  store.add(mentorKey(studentId, 'curator', curatorId, courseId));
}

function hasCuratorOnCourse(studentId: number, courseId: number): boolean {
  for (const key of store) {
    const [sid, kind, , cid] = key.split(':');
    if (Number(sid) === studentId && kind === 'curator' && Number(cid) === courseId) return true;
  }
  return false;
}

assignCurator(100, 501, 1);
assignCurator(100, 502, 2);

assert(hasCuratorOnCourse(100, 1), 'course 1 curator');
assert(hasCuratorOnCourse(100, 2), 'course 2 curator');
assert(!hasCuratorOnCourse(100, 3), 'no course 3');

console.log('test-multicourse-staff: ok');
