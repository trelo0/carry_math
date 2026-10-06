import type { SupabaseClient } from '@supabase/supabase-js';
import { getMember } from '@/lib/bot/roles';
import { pluralRu, pluralRuWithCount } from '@/lib/russianPlural';
import type { InlineButton } from './core';
import { shorten } from './core';
import { fetchSchoolRecentEvents, formatSchoolEventsBlock } from './home-events';
import { fetchHomeAttentionTasks, type HomeAttentionTask } from './home-attention';
import {
  fetchAdminHubMetrics,
  fetchTodayLessonsPreview,
  type AdminHubMetrics,
  type TodayLessonRow,
} from './hub-metrics';
import { memberDisplayName } from './users';

function moscowGreeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).format(
      new Date(),
    ),
  );
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function buildHeader(adminName: string | null, testFooter: string): string {
  const lines = ['🔐 Панель администратора', 'District', ''];
  const name = adminName?.trim();
  if (name && name.length >= 2 && !name.startsWith('ID ')) {
    lines.push(`${moscowGreeting()}, ${name} 👋`);
    lines.push('Вот что происходит в школе сейчас.');
  }
  if (testFooter) lines.push(testFooter.trim());
  return lines.join('\n');
}

function formatAttentionBlock(tasks: HomeAttentionTask[]): string[] {
  const lines = ['⚡ ТРЕБУЕТ ВНИМАНИЯ', ''];
  if (tasks.length === 0) {
    lines.push('✓ Всё спокойно', 'Нет задач, требующих вашего внимания.');
    return lines;
  }
  for (const task of tasks) {
    lines.push(task.body, '');
  }
  return lines.slice(0, -1);
}


async function groupTitle(admin: SupabaseClient, groupId: number | null): Promise<string | null> {
  if (!groupId) return null;
  const { data } = await admin.from('groups').select('title').eq('id', groupId).maybeSingle();
  return data?.title ? String(data.title) : null;
}

async function formatTodayLessonText(admin: SupabaseClient, row: TodayLessonRow): Promise<string> {
  const time = new Date(row.starts_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
  const member = await getMember(admin, row.telegram_id);
  const person = member ? memberDisplayName(member) : `#${row.telegram_id}`;
  const topic = row.topic?.trim() || 'Математика';

  if (row.kind === 'group') {
    const group = (await groupTitle(admin, row.group_id)) || 'Группа';
    return [`${time} · ${shorten(group, 28)}`, `Групповое · ${shorten(topic, 32)}`].join('\n');
  }
  if (row.kind === 'trial') {
    return [`${time} · ${shorten(person, 28)}`, `Пробное · ${shorten(topic, 32)}`].join('\n');
  }
  const kindLabel = row.kind === 'individual' ? 'Индивидуальное' : shorten(row.kind, 20);
  return [`${time} · ${shorten(person, 28)}`, `${kindLabel} · ${shorten(topic, 32)}`].join('\n');
}

function formatStateBlock(metrics: AdminHubMetrics): string[] {
  const leadsNew = pluralRuWithCount(metrics.leadsNew, 'новая', 'новые', 'новых');
  const pkgEnding = pluralRu(
    metrics.packagesLow,
    'пакет заканчивается',
    'пакета заканчиваются',
    'пакетов заканчиваются',
  );
  const problemsLine =
    metrics.scheduleProblems > 0
      ? `${pluralRuWithCount(metrics.scheduleProblems, 'проблема', 'проблемы', 'проблем')}`
      : 'проблем нет';

  return [
    '📊 СОСТОЯНИЕ ШКОЛЫ',
    '',
    '👨‍🎓 Ученики',
    `${metrics.studentsActive} активных · ${metrics.studentsNew} новых · ${metrics.studentsPaused} на паузе`,
    '',
    '📨 Заявки',
    `${leadsNew} · ${metrics.leadsInProgress} в работе`,
    '',
    '💳 Финансы',
    `${metrics.purchasesPending} ожидают оплаты · ${metrics.packagesLow} ${pkgEnding}`,
    '',
    '📅 Занятия',
    `${metrics.lessonsToday} сегодня · ${problemsLine}`,
  ];
}

export type AdminHomeDashboard = {
  text: string;
  keyboard: InlineButton[][] | undefined;
};

export async function buildAdminHomeDashboard(
  admin: SupabaseClient,
  telegramId: number,
  testFooter = '',
): Promise<AdminHomeDashboard> {
  const [metrics, tasks, schoolEvents, todayPreview, member] = await Promise.all([
    fetchAdminHubMetrics(admin),
    fetchHomeAttentionTasks(admin),
    fetchSchoolRecentEvents(admin, 5),
    fetchTodayLessonsPreview(admin, 5),
    getMember(admin, telegramId),
  ]);
  const eventLines = formatSchoolEventsBlock(schoolEvents);

  const adminName = member?.full_name ? String(member.full_name) : null;
  const todayLines: string[] = [];
  for (const row of todayPreview.rows) {
    todayLines.push(await formatTodayLessonText(admin, row));
    todayLines.push('');
  }
  if (todayLines.length > 0) todayLines.pop();

  const todayBlock =
    todayLines.length > 0 ? todayLines : ['Занятий сегодня нет.'];

  const text = [
    buildHeader(adminName, testFooter),
    '',
    ...formatAttentionBlock(tasks),
    '',
    ...eventLines,
    '',
    '📅 СЕГОДНЯ',
    '',
    todayPreview.dateLabel,
    '',
    ...todayBlock,
    '',
    ...formatStateBlock(metrics),
  ].join('\n');

  const keyboard: InlineButton[][] = [];
  for (const task of tasks) {
    keyboard.push([{ text: task.buttonText, callback_data: task.callback }]);
  }
  for (const row of todayPreview.rows) {
    const time = new Date(row.starts_at).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
    });
    let label = `${time} · Занятие`;
    if (row.kind === 'group') {
      const group = await groupTitle(admin, row.group_id);
      label = `${time} · ${shorten(group ?? 'Группа', 24)}`;
    } else {
      const memberRow = await getMember(admin, row.telegram_id);
      if (memberRow) label = `${time} · ${shorten(memberDisplayName(memberRow), 24)}`;
    }
    keyboard.push([{ text: label, callback_data: `ae:ls:l:${row.id}:0:0` }]);
  }

  return { text, keyboard: keyboard.length > 0 ? keyboard : undefined };
}
