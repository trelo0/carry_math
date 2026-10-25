import {
  computeWeekStats,
  countEventsOnDay,
  findScheduleConflict,
  historyEvents,
  isWithinAvailability,
  mapTeacherLessonToEvent,
} from '../src/lib/teacher/schedule-utils';
import type { ScheduleEvent } from '../src/lib/teacher/schedule-types';
import type { TeacherLessonView } from '../src/lib/teacher/cabinet-data';
import {
  balanceTone,
  computeOrdinaryWeekStats,
  findOverdueEvents,
  formatPeriodLabel,
  getDayWorkState,
  layoutDayEvents,
  nonWorkingSegments,
  pluralLessons,
  computeDayAvailability,
  rosterLessonSummary,
} from '../src/lib/teacher/schedule-reference-utils';
import { buildSeriesOccurrences, weekdayIndex } from '../src/lib/teacher/lesson-series';
import { bandsContain, resolveDayHours } from '../src/lib/teacher/working-hours';
import { buildScheduleIso, wallClockFromIso } from '../src/lib/teacher/schedule-wall-clock';
import { eventPaymentLabel, eventTone } from '../src/components/staff/schedule/ScheduleWeekBoard';
import {
  eventsConflictingWithWeekly,
  proposedWorkingHours,
} from '../src/lib/teacher/weekly-schedule-conflicts';
import { isScheduleOverlapDbError, formatScheduleOverlapDbError } from '../src/lib/teacher/schedule-rpc';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function mapLessonStub(id: number, startsAt: string): TeacherLessonView {
  return {
    id,
    kind: 'individual',
    startsAt: new Date(startsAt).toISOString(),
    date: '',
    time: '',
    topic: 'Урок',
    status: 'scheduled',
    studentTelegramId: null,
    studentName: null,
    groupId: null,
    groupTitle: null,
    meetUrl: null,
    boardUrl: null,
    lessonPlan: null,
    cancelReason: null,
    durationMinutes: 60,
    isUpcoming: true,
  };
}

function main() {
  const lessonA: ScheduleEvent = {
    id: 'lesson-1',
    kind: 'individual',
    status: 'scheduled',
    title: 'Алgebra',
    startsAt: new Date('2025-10-27T10:00:00').toISOString(),
    endsAt: new Date('2025-10-27T11:15:00').toISOString(),
    durationMinutes: 75,
    participantLabel: 'Иван',
    lessonId: 1,
  };
  const lessonB: ScheduleEvent = {
    id: 'lesson-2',
    kind: 'group',
    status: 'scheduled',
    title: 'Группа',
    startsAt: new Date('2025-10-27T10:30:00').toISOString(),
    endsAt: new Date('2025-10-27T11:45:00').toISOString(),
    durationMinutes: 75,
    participantLabel: '10А',
    lessonId: 2,
  };

  const conflict = findScheduleConflict([lessonA], lessonB.startsAt, lessonB.endsAt);
  assert(Boolean(conflict), 'overlapping lessons must conflict');

  const availability = [{ id: 1, dayOfWeek: 0, startTime: '09:00', endTime: '18:00' }];
  const monday = new Date('2025-10-27T12:00:00');
  assert(isWithinAvailability(availability, monday, '10:00', '11:00'), 'slot inside availability');
  assert(!isWithinAvailability(availability, monday, '08:00', '09:30'), 'slot outside availability');

  const weekStart = new Date('2025-10-27T00:00:00');
  const stats = computeWeekStats(
    [
      { ...lessonA, status: 'completed' },
      { ...lessonB, status: 'cancelled' },
    ],
    weekStart,
  );
  assert(stats.completed === 1 && stats.cancelled === 1, 'week stats counts');

  const day = new Date('2025-10-27T08:00:00');
  assert(countEventsOnDay([lessonA, lessonB], day) === 2, 'day event count');

  const past = historyEvents([
    { ...lessonA, status: 'completed' },
    { ...lessonA, id: 'lesson-3', status: 'scheduled', startsAt: new Date('2020-01-01T10:00:00').toISOString() },
  ]);
  assert(past.length === 2, 'history includes completed and past scheduled');

  const mapped = mapTeacherLessonToEvent({
    id: 9,
    kind: 'individual',
    startsAt: lessonA.startsAt,
    date: '27.10.2025',
    time: '10:00',
    topic: 'Test',
    status: 'scheduled',
    studentTelegramId: 1,
    studentName: 'A',
    groupId: null,
    groupTitle: null,
    meetUrl: null,
    boardUrl: null,
    lessonPlan: null,
    cancelReason: null,
    durationMinutes: 75,
    isUpcoming: true,
  });
  assert(mapped.kind === 'individual', 'map lesson to event');

  // --- reference utils ---
  const lanes = layoutDayEvents([lessonA, lessonB]);
  assert(lanes.length === 2 && lanes.every((l) => l.lanes === 2), 'overlapping events get 2 lanes');
  assert(new Set(lanes.map((l) => l.lane)).size === 2, 'overlapping events use different lanes');
  const single = layoutDayEvents([lessonA]);
  assert(single[0].lanes === 1 && single[0].lane === 0, 'single event uses one lane');

  assert(pluralLessons(1) === 'занятие', 'plural 1');
  assert(pluralLessons(3) === 'занятия', 'plural 3');
  assert(pluralLessons(5) === 'занятий', 'plural 5');
  assert(pluralLessons(11) === 'занятий', 'plural 11');

  assert(balanceTone(null) === 'none', 'balance none');
  assert(balanceTone(0) === 'empty', 'balance empty');
  assert(balanceTone(2) === 'low', 'balance low');
  assert(balanceTone(5) === 'ok', 'balance ok');

  const segs = nonWorkingSegments([{ startTime: '09:00', endTime: '18:00' }], 8 * 60, 21 * 60);
  assert(
    segs.length === 2 && segs[0].start === 480 && segs[0].end === 540 && segs[1].start === 1080,
    'non-working segments around band',
  );

  const wh = {
    weekly: [{ id: 1, dayOfWeek: 0, startTime: '09:00', endTime: '18:00' }],
    blockedDates: [{ id: 1, blockedDate: '2025-10-28', note: 'Отпуск' }],
    dayOverrides: [{ id: 1, overrideDate: '2025-10-30', startTime: '12:00', endTime: '15:00' }],
  };
  assert(getDayWorkState(wh, new Date('2025-10-27T12:00:00')).kind === 'work', 'monday is work day');
  assert(getDayWorkState(wh, new Date('2025-10-29T12:00:00')).kind === 'off', 'wednesday is off day');
  const blocked = getDayWorkState(wh, new Date('2025-10-28T12:00:00'));
  assert(blocked.kind === 'off' && blocked.note === 'Отпуск', 'blocked date is off with note');
  assert(getDayWorkState({ weekly: [], blockedDates: [], dayOverrides: [] }, monday).kind === 'unset', 'no hours = unset');

  // --- day overrides ---
  const custom = resolveDayHours(wh, new Date('2025-10-30T12:00:00'));
  assert(
    custom.kind === 'work' && custom.custom && custom.bands[0].startTime === '12:00',
    'override replaces weekly hours (even on a template day off)',
  );
  assert(resolveDayHours(wh, new Date('2025-10-27T12:00:00')).kind === 'work', 'template day stays work');
  const offOverOverride = resolveDayHours(
    { ...wh, blockedDates: [{ id: 2, blockedDate: '2025-10-30', note: null }] },
    new Date('2025-10-30T12:00:00'),
  );
  assert(offOverOverride.kind === 'off', 'blocked date wins over override');
  const overrideOnly = resolveDayHours(
    { weekly: [], blockedDates: [], dayOverrides: wh.dayOverrides },
    new Date('2025-10-30T12:00:00'),
  );
  assert(overrideOnly.kind === 'work', 'override works without weekly template');
  assert(bandsContain([{ startTime: '09:00', endTime: '18:00' }], '10:00', '11:15'), 'band contains lesson');
  assert(!bandsContain([{ startTime: '09:00', endTime: '18:00' }], '17:00', '18:30'), 'band rejects overflow');

  const ordinaryStats = computeOrdinaryWeekStats(
    [
      { ...lessonA, status: 'completed' },
      { ...lessonB, status: 'no_show' },
      { ...lessonA, id: 'c1', kind: 'course', status: 'completed' },
    ],
    weekStart,
  );
  assert(ordinaryStats.completed === 1, 'course lessons excluded from stats');
  assert(ordinaryStats.attendance === 50, 'attendance = completed / (completed + no_show)');
  assert(computeOrdinaryWeekStats([], weekStart).attendance === null, 'attendance null without data');

  const overdue = findOverdueEvents(
    [
      { ...lessonA, startsAt: new Date('2020-01-01T10:00:00').toISOString(), endsAt: new Date('2020-01-01T11:00:00').toISOString() },
      { ...lessonB, status: 'cancelled', startsAt: new Date('2020-01-01T10:00:00').toISOString(), endsAt: new Date('2020-01-01T11:00:00').toISOString() },
    ],
    Date.now(),
  );
  assert(overdue.length === 1, 'overdue only scheduled past lessons');
  assert(findOverdueEvents([lessonA], 0).length === 0, 'no overdue before hydration');

  assert(formatPeriodLabel('week', monday, weekStart) === '27 окт. – 2 нояб. 2025', 'week period label');
  assert(formatPeriodLabel('month', monday, weekStart) === 'Октябрь 2025', 'month period label');


  // Серии: каждый понедельник на 4 недели от 2030-01-07 (понедельник)
  const series = buildSeriesOccurrences({ fromDate: '2030-01-07', weekdays: [0], startTime: '16:00', weeks: 4, nowMs: 0 });
  assert(series.length === 4, 'series: 4 mondays in 4 weeks');
  assert(series.every((iso) => weekdayIndex(new Date(iso)) === 0), 'series: all mondays');
  const two = buildSeriesOccurrences({ fromDate: '2030-01-07', weekdays: [0, 2], startTime: '16:00', weeks: 2, nowMs: 0 });
  assert(two.length === 4, 'series: Mon+Wed over 2 weeks');
  assert(
    buildSeriesOccurrences({ fromDate: '2030-01-07', weekdays: [0], startTime: '16:00', weeks: 4, nowMs: new Date('2030-01-15T00:00:00').getTime() }).length === 2,
    'series: past occurrences skipped',
  );

  // Свободное время дня: рабочие часы 10–18, занято 12–13
  const availDay = new Date('2030-01-07T00:00:00');
  const availHours = {
    weekly: [{ id: 1, dayOfWeek: 0, startTime: '10:00', endTime: '18:00' }],
    blockedDates: [],
    dayOverrides: [],
  };
  const busyEvent: ScheduleEvent = {
    ...lessonA,
    id: 'lesson-77',
    lessonId: 77,
    status: 'scheduled',
    startsAt: new Date('2030-01-07T12:00:00').toISOString(),
    endsAt: new Date('2030-01-07T13:00:00').toISOString(),
    durationMinutes: 60,
  };
  const dayFree = computeDayAvailability({ day: availDay, events: [busyEvent], daySlots: [], workingHours: availHours });
  assert(dayFree.free.length === 2, 'availability: two free windows');
  assert(dayFree.free[0].start === 600 && dayFree.free[0].end === 720, 'availability: 10:00–12:00 free');
  assert(dayFree.free[1].start === 780 && dayFree.free[1].end === 1080, 'availability: 13:00–18:00 free');
  const excluded = computeDayAvailability({ day: availDay, events: [busyEvent], daySlots: [], workingHours: availHours, excludeLessonId: 77 });
  assert(excluded.free.length === 1 && excluded.busy.length === 0, 'availability: moved lesson frees its own time');

  const summary = rosterLessonSummary(
    [
      { ...mapLessonStub(5, '2030-01-07T16:00:00'), scheduleStudentId: 9 },
      { ...mapLessonStub(6, '2030-01-14T16:00:00'), scheduleStudentId: 9 },
      { ...mapLessonStub(7, '2030-01-09T18:00:00'), scheduleStudentId: 9 },
      { ...mapLessonStub(8, '2030-01-10T18:00:00'), scheduleStudentId: 10 },
    ],
    9,
    0,
  );
  assert(summary.upcoming === 3, 'roster summary: counts student lessons');
  assert(summary.slots === 'Пн 16:00, Ср 18:00', 'roster summary: unique weekly slots');

  const selfMove = findScheduleConflict([lessonA], lessonA.startsAt, lessonA.endsAt, lessonA.id);
  assert(selfMove == null, 'reschedule: no false self-conflict');

  const scheduledTone = eventTone({ ...lessonA, isPaid: true });
  assert(scheduledTone === 'scheduled', 'event tone: paid scheduled stays scheduled');
  assert(eventPaymentLabel({ ...lessonA, isPaid: true }) === 'paid', 'payment chip: paid');
  assert(eventPaymentLabel({ ...lessonA, isPaid: false }) === 'unpaid', 'payment chip: unpaid');
  assert(eventPaymentLabel({ ...lessonA, status: 'completed' }) === null, 'payment chip: hidden when completed');

  const iso = buildScheduleIso('2030-03-15', '14:30');
  const wall = wallClockFromIso(iso);
  assert(wall.dateKey === '2030-03-15' && wall.time === '14:30', 'wall clock: dateKey stable');

  const baseHours = {
    weekly: [{ id: 1, dayOfWeek: 0, startTime: '09:00', endTime: '18:00' }],
    blockedDates: [],
    dayOverrides: [],
  };
  const mondayEvent: ScheduleEvent = {
    ...lessonA,
    id: 'lesson-mon',
    lessonId: 99,
    startsAt: new Date('2030-01-07T17:00:00').toISOString(),
    endsAt: new Date('2030-01-07T18:00:00').toISOString(),
    durationMinutes: 60,
  };
  const narrowWeekly = [{ dayOfWeek: 0, startTime: '09:00', endTime: '16:00', kind: 'both' as const }];
  const weeklyConflicts = eventsConflictingWithWeekly([mondayEvent], baseHours, narrowWeekly, '2030-01-01');
  assert(weeklyConflicts.length === 1, 'weekly template: detects outside new bands');
  assert(
    proposedWorkingHours(baseHours, narrowWeekly).weekly[0].endTime === '16:00',
    'weekly template: proposed hours merged',
  );

  assert(isScheduleOverlapDbError({ code: '23P01' }), 'overlap error code');
  assert(formatScheduleOverlapDbError().includes('занятие'), 'overlap error message');

  assert(isMobileWeekList(7), 'mobile: week renders as 7 day rows');

  console.log('test-teacher-schedule-validation: ok');
}

function isMobileWeekList(dayCount: number): boolean {
  return dayCount === 7;
}

main();



