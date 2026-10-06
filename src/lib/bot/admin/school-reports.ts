import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deliver, InlineButton } from './core';
import { homeButton } from './core';
import { fetchAdminHubMetrics } from './hub-metrics';
import { periodBounds, type ReportPeriodPreset } from './report-period';

export type SchoolReportPeriod = ReportPeriodPreset;

const PERIOD_IDS: SchoolReportPeriod[] = ['today', '7d', '30d', 'month'];

function periodKeyboard(active: SchoolReportPeriod, backCallback = 'ah:more'): InlineButton[][] {
  const row = (id: SchoolReportPeriod, text: string): InlineButton => ({
    text: active === id ? `• ${text}` : text,
    callback_data: `ah:school:rep:${id}`,
  });
  return [
    [row('today', 'Сегодня'), row('7d', '7 дней')],
    [row('30d', '30 дней'), row('month', 'Месяц')],
    [{ text: '⬅️ Прочее', callback_data: backCallback }],
    [homeButton()],
  ];
}

function sectionNav(period: SchoolReportPeriod): InlineButton[][] {
  const p = period;
  return [
    [
      { text: '👨‍🎓 Ученики', callback_data: `ah:school:sec:students:${p}` },
      { text: '📨 Заявки', callback_data: `ah:school:sec:leads:${p}` },
    ],
    [
      { text: '📅 Занятия', callback_data: `ah:school:sec:lessons:${p}` },
      { text: '👨‍🏫 Преподаватели', callback_data: `ah:school:sec:teachers:${p}` },
    ],
    [{ text: '🎓 Обучение', callback_data: `ah:school:sec:education:${p}` }],
    [{ text: '⬅️ Сводка', callback_data: `ah:school:rep:${p}` }],
    [{ text: '⬅️ Прочее', callback_data: 'ah:more' }],
    [homeButton()],
  ];
}

async function countLeadsCreated(admin: SupabaseClient, fromIso: string, toIso: string): Promise<number> {
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fromIso)
    .lt('created_at', toIso);
  if (error) {
    if (String(error.message ?? '').includes('leads')) return 0;
    throw error;
  }
  return count ?? 0;
}

async function countLessonsByStatus(
  admin: SupabaseClient,
  fromIso: string,
  toIso: string,
  status: string,
): Promise<number> {
  const { count, error } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('status', status)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso);
  if (error) {
    if (String(error.message ?? '').includes('scheduled_lessons')) return 0;
    throw error;
  }
  return count ?? 0;
}

async function countTeacherLessons(
  admin: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<Array<{ teacherId: number; n: number }>> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select('teacher_telegram_id')
    .eq('status', 'completed')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .not('teacher_telegram_id', 'is', null)
    .limit(500);
  if (error) {
    if (String(error.message ?? '').includes('scheduled_lessons')) return [];
    throw error;
  }
  const map = new Map<number, number>();
  for (const row of data ?? []) {
    const id = row.teacher_telegram_id as number;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([teacherId, n]) => ({ teacherId, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
}

async function countHomeworkSubmitted(admin: SupabaseClient, fromIso: string, toIso: string): Promise<number> {
  const { count, error } = await admin
    .from('homework_assignments')
    .select('id', { count: 'exact', head: true })
    .gte('submitted_at', fromIso)
    .lt('submitted_at', toIso);
  if (error) return 0;
  return count ?? 0;
}

export async function renderSchoolReports(
  admin: SupabaseClient,
  deliver: Deliver,
  period: SchoolReportPeriod = 'today',
): Promise<void> {
  if (period === 'custom') {
    await deliver('Свой период для отчётов пока через пресеты (сегодня / 7 / 30 / месяц).', {
      inline_keyboard: periodKeyboard('today'),
    });
    return;
  }

  const { fromIso, toIso, label } = periodBounds(period);
  const metrics = await fetchAdminHubMetrics(admin);

  const [leadsNew, completed, cancelled, noShow] = await Promise.all([
    countLeadsCreated(admin, fromIso, toIso),
    countLessonsByStatus(admin, fromIso, toIso, 'completed'),
    countLessonsByStatus(admin, fromIso, toIso, 'cancelled'),
    countLessonsByStatus(admin, fromIso, toIso, 'no_show'),
  ]);

  const topTeachers = await countTeacherLessons(admin, fromIso, toIso);
  let teacherBlock = '';
  if (topTeachers.length > 0) {
    const { getMember } = await import('@/lib/bot/roles');
    const { memberDisplayName } = await import('./users');
    const lines: string[] = [];
    for (const t of topTeachers.slice(0, 3)) {
      const member = await getMember(admin, t.teacherId);
      const name = member ? memberDisplayName(member) : `ID ${t.teacherId}`;
      lines.push(`${name} — ${t.n}`);
    }
    teacherBlock = ['', '👨‍🏫 Топ проведённых:', ...lines].join('\n');
  }

  const text = [
    '📊 Отчёты',
    '',
    `📅 Период: ${label}`,
    '',
    '👨‍🎓 Ученики',
    `Активных — ${metrics.studentsActive}`,
    `Новых за 7 дней — ${metrics.studentsNew}`,
    '',
    '📨 Заявки',
    `Новых за период — ${leadsNew}`,
    `В работе сейчас — ${metrics.leadsInProgress}`,
    '',
    '📅 Занятия',
    `Проведено — ${completed}`,
    `Отменено — ${cancelled}`,
    `Не состоялось — ${noShow}`,
    teacherBlock,
    '',
    'Детализация — кнопки ниже.',
    'Финансы — 💳 Финансы → 📊 Отчёты.',
  ].join('\n');

  const nav = sectionNav(period);
  await deliver(text, {
    inline_keyboard: [nav[0], nav[1], nav[2], ...periodKeyboard(period).slice(0, 2), nav[4], nav[5]],
  });
}

export type SchoolReportSection = 'students' | 'leads' | 'lessons' | 'teachers' | 'education';

export async function renderSchoolReportSection(
  admin: SupabaseClient,
  deliver: Deliver,
  section: SchoolReportSection,
  period: SchoolReportPeriod,
): Promise<void> {
  if (period === 'custom') {
    await renderSchoolReports(admin, deliver, 'today');
    return;
  }

  const { fromIso, toIso, label } = periodBounds(period);
  const metrics = await fetchAdminHubMetrics(admin);
  const titles: Record<SchoolReportSection, string> = {
    students: '👨‍🎓 Ученики',
    leads: '📨 Заявки',
    lessons: '📅 Занятия',
    teachers: '👨‍🏫 Преподаватели',
    education: '🎓 Обучение',
  };

  let body = '';
  if (section === 'students') {
    body = [`Активных — ${metrics.studentsActive}`, `Новых за 7 дней — ${metrics.studentsNew}`].join('\n');
  } else if (section === 'leads') {
    const leadsNew = await countLeadsCreated(admin, fromIso, toIso);
    body = [
      `Новых за период — ${leadsNew}`,
      `В работе — ${metrics.leadsInProgress}`,
      `Новых (статус new) — ${metrics.leadsNew}`,
    ].join('\n');
  } else if (section === 'lessons') {
    const [completed, cancelled, noShow, planned] = await Promise.all([
      countLessonsByStatus(admin, fromIso, toIso, 'completed'),
      countLessonsByStatus(admin, fromIso, toIso, 'cancelled'),
      countLessonsByStatus(admin, fromIso, toIso, 'no_show'),
      countLessonsByStatus(admin, fromIso, toIso, 'scheduled'),
    ]);
    body = [
      `Проведено — ${completed}`,
      `Запланировано (старт в периоде) — ${planned}`,
      `Отменено — ${cancelled}`,
      `Не состоялось — ${noShow}`,
    ].join('\n');
  } else if (section === 'teachers') {
    const top = await countTeacherLessons(admin, fromIso, toIso);
    if (top.length === 0) {
      body = 'За период нет проведённых занятий с указанным преподавателем.';
    } else {
      const { getMember } = await import('@/lib/bot/roles');
      const { memberDisplayName } = await import('./users');
      const lines: string[] = [];
      for (const t of top) {
        const member = await getMember(admin, t.teacherId);
        const name = member ? memberDisplayName(member) : `ID ${t.teacherId}`;
        lines.push(`${name}\nПроведено: ${t.n}`);
      }
      body = lines.join('\n\n');
    }
  } else {
    const submitted = await countHomeworkSubmitted(admin, fromIso, toIso);
    body = [
      `ДЗ сдано за период — ${submitted}`,
      `ДЗ на проверке (сейчас) — ${metrics.homeworkPendingReview}`,
    ].join('\n');
  }

  const text = [titles[section], '', `📅 ${label}`, '', body].join('\n');
  await deliver(text, { inline_keyboard: sectionNav(period) });
}

export function parseSchoolReportCallback(data: string): SchoolReportPeriod | null {
  const m = data.match(/^ah:school:rep:(today|7d|30d|month)$/);
  return m ? (m[1] as SchoolReportPeriod) : null;
}

export function parseSchoolReportSectionCallback(
  data: string,
): { section: SchoolReportSection; period: SchoolReportPeriod } | null {
  const m = data.match(/^ah:school:sec:(students|leads|lessons|teachers|education):(today|7d|30d|month)$/);
  if (!m) return null;
  return { section: m[1] as SchoolReportSection, period: m[2] as SchoolReportPeriod };
}

export function isSchoolReportsAction(data: string): boolean {
  return (
    data === 'ah:more:reports' ||
    parseSchoolReportCallback(data) !== null ||
    parseSchoolReportSectionCallback(data) !== null
  );
}
