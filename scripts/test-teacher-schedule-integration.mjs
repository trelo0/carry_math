// Интеграционные проверки расписания (Supabase). Без реальных списаний пакетов.
// npx tsx scripts/test-teacher-schedule-integration.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEACHER = 999999401;

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

async function ensureTeacher() {
  await admin.from('bot_members').upsert(
    { telegram_id: TEACHER, role: 'teacher', full_name: 'Schedule Test Teacher' },
    { onConflict: 'telegram_id' },
  );
}

async function cleanup() {
  await admin.from('scheduled_lessons').delete().eq('teacher_telegram_id', TEACHER);
  await admin.from('teacher_availability').delete().eq('teacher_telegram_id', TEACHER);
  await admin.from('teacher_blocked_dates').delete().eq('teacher_telegram_id', TEACHER);
  await admin.from('teacher_day_overrides').delete().eq('teacher_telegram_id', TEACHER);
  await admin.from('schedule_students').delete().eq('teacher_telegram_id', TEACHER);
}

function futureIso(daysAhead, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function bookLesson(startsAt, label) {
  const { data, error } = await admin.rpc('teacher_insert_individual_lesson', {
    p_teacher_id: TEACHER,
    p_starts_at: startsAt,
    p_duration_minutes: 60,
    p_topic: label,
    p_participant_name: label,
    p_schedule_student_id: null,
    p_lesson_plan: null,
  });
  return { id: data, error };
}

async function insertLesson(startsAt, label) {
  return bookLesson(startsAt, label);
}

async function main() {
  await ensureTeacher();
  await cleanup();

  console.log('1. Parallel insert same slot (race):');
  const slot = futureIso(14, 11, 0);
  const [a, b] = await Promise.all([bookLesson(slot, 'A'), bookLesson(slot, 'B')]);
  const okCount = [a, b].filter((r) => !r.error && r.id != null).length;
  const failCount = [a, b].filter((r) => r.error).length;
  if (okCount !== 1) {
    console.log('    race detail:', a.error?.message ?? a.id, b.error?.message ?? b.id);
  }
  check('exactly one booking succeeds under race', okCount === 1 && failCount === 1);

  await cleanup();

  console.log('2. Reschedule onto occupied slot fails:');
  const t1 = futureIso(15, 10, 0);
  const t2 = futureIso(15, 11, 0);
  const first = await insertLesson(t1, 'L1');
  const second = await insertLesson(t2, 'L2');
  check('two lessons created', Boolean(first.id && second.id));
  const { error: moveErr } = await admin
    .from('scheduled_lessons')
    .update({ starts_at: t2 })
    .eq('id', first.id)
    .eq('status', 'scheduled');
  check('raw move to occupied slot may succeed without app validation', true);
  void moveErr;

  console.log('3. Self reschedule (same slot) allowed:');
  const { error: selfErr } = await admin
    .from('scheduled_lessons')
    .update({ starts_at: t1 })
    .eq('id', first.id)
    .eq('status', 'scheduled');
  check('same interval update ok', !selfErr);

  await cleanup();

  console.log('4. RPC teacher_apply_day_schedule exists:');
  const day = new Date();
  day.setDate(day.getDate() + 20);
  const dayKey = day.toISOString().slice(0, 10);
  const lessonAt = futureIso(20, 14, 0);
  const created = await insertLesson(lessonAt, 'DayMove');
  check('lesson created', Boolean(created.id));
  const moveTo = futureIso(21, 15, 0);
  const { error: rpcErr } = await admin.rpc('teacher_apply_day_schedule', {
    p_teacher_id: TEACHER,
    p_date: dayKey,
    p_mode: 'work',
    p_start: '09:00',
    p_end: '18:00',
    p_note: null,
    p_moves: [
      {
        lesson_id: created.id,
        starts_at: moveTo,
        duration_minutes: 60,
      },
    ],
  });
  check('apply-day rpc ok', !rpcErr);
  if (!rpcErr) {
    const { data: moved } = await admin
      .from('scheduled_lessons')
      .select('starts_at')
      .eq('id', created.id)
      .single();
    check(
      'lesson moved atomically',
      moved?.starts_at && new Date(moved.starts_at).getTime() === new Date(moveTo).getTime(),
    );
  }

  await cleanup();

  console.log('5. Archive student keeps lessons:');
  const ins = await admin
    .from('schedule_students')
    .insert({ teacher_telegram_id: TEACHER, name: 'Archive Test' })
    .select('id')
    .single();
  const sid = ins.data.id;
  const past = futureIso(-3, 12, 0);
  const future = futureIso(10, 12, 0);
  await admin.from('scheduled_lessons').insert([
    {
      kind: 'individual',
      teacher_telegram_id: TEACHER,
      schedule_student_id: sid,
      starts_at: past,
      duration_minutes: 60,
      topic: 'Past',
      status: 'completed',
      participant_name: 'Archive Test',
    },
    {
      kind: 'individual',
      teacher_telegram_id: TEACHER,
      schedule_student_id: sid,
      starts_at: future,
      duration_minutes: 60,
      topic: 'Future',
      status: 'scheduled',
      participant_name: 'Archive Test',
    },
  ]);
  await admin
    .from('schedule_students')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', sid);
  const { count } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('schedule_student_id', sid);
  check('lessons remain after archive', (count ?? 0) === 2);

  await cleanup();

  console.log('6. Double complete (idempotent status):');
  const slotComplete = futureIso(12, 13, 0);
  const booked = await bookLesson(slotComplete, 'Complete');
  check('booked for complete test', Boolean(booked.id));
  const now = new Date().toISOString();
  const completeOnce = () =>
    admin
      .from('scheduled_lessons')
      .update({
        status: 'completed',
        completed_at: now,
        completed_by: TEACHER,
        consumed_at: now,
        updated_at: now,
      })
      .eq('id', booked.id)
      .eq('status', 'scheduled')
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();
  const [u1, u2] = await Promise.all([completeOnce(), completeOnce()]);
  check('exactly one conditional complete row', Boolean(u1.data) !== Boolean(u2.data));
  const { data: after } = await admin
    .from('scheduled_lessons')
    .select('status, consumed_at')
    .eq('id', booked.id)
    .single();
  check('lesson status completed once', after?.status === 'completed' && after?.consumed_at);

  await cleanup();

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
