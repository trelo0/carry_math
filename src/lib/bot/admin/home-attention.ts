import type { SupabaseClient } from '@supabase/supabase-js';
import { getMember } from '@/lib/bot/roles';
import { countViolations } from '../moderation';
import { listPendingPurchaseRequests } from '../purchase-requests';
import { listDueLeadFollowups } from './lead-followups';
import { countScheduledLessonsForPackage } from '../lesson-credits';
import type { AdminHubMetrics } from './hub-metrics';
import { memberDisplayName } from './users';

export type AttentionItem = { text: string; callback: string };

/** Сводные пункты для экрана «проблемы» (навигация в разделы). */
export function buildAttentionItems(metrics: AdminHubMetrics): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (metrics.leadsNew > 0) {
    items.push({ text: `📨 Новые заявки — ${metrics.leadsNew}`, callback: 'ah:go:leads:new' });
  }
  if (metrics.purchasesPending > 0) {
    items.push({
      text: `💳 Ожидают оплаты — ${metrics.purchasesPending}`,
      callback: 'ah:go:finance:pending',
    });
  }
  if (metrics.packagesLow > 0) {
    items.push({
      text: `📦 Пакеты заканчиваются — ${metrics.packagesLow}`,
      callback: 'ah:go:finance:packages',
    });
  }
  if (metrics.homeworkLongPending > 0) {
    items.push({
      text: `📝 Домашки долго не проверяются — ${metrics.homeworkLongPending}`,
      callback: 'ae:hw:hub',
    });
  }
  if (metrics.scheduleProblems > 0) {
    items.push({
      text: `📅 Проблемы расписания — ${metrics.scheduleProblems}`,
      callback: 'ah:go:finance:overbook',
    });
  }
  if (metrics.violationsPending > 0) {
    items.push({
      text: `⚠️ Другие проблемы — ${metrics.violationsPending}`,
      callback: 'ah:go:moderation',
    });
  }
  return items;
}

export type HomeAttentionTask = {
  body: string;
  buttonText: string;
  callback: string;
};

const LONG_HW_MS = 3 * 86400000;
const MAX_TASKS = 3;

async function memberName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  if (!member) return '';
  const name = memberDisplayName(member).trim();
  return name && !name.startsWith('ID ') ? name : '';
}

export async function fetchHomeAttentionTasks(
  admin: SupabaseClient,
  limit = MAX_TASKS,
): Promise<HomeAttentionTask[]> {
  const tasks: HomeAttentionTask[] = [];

  let newLeads: Array<{ id: string; name: string | null }> = [];
  try {
    const { data, error } = await admin
      .from('leads')
      .select('id, name, status')
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error) newLeads = (data ?? []) as typeof newLeads;
  } catch {
    newLeads = [];
  }

  if (tasks.length < limit) {
    try {
      const due = await listDueLeadFollowups(admin, limit - tasks.length);
      for (const fu of due) {
        const name = String(fu.lead_name ?? '').trim() || 'Клиент';
        tasks.push({
          body: ['🔔 Нужно связаться', name, fu.note ?? 'Напоминание по заявке'].join('\n'),
          buttonText: '📨 Открыть заявку',
          callback: `al:fu:open:${fu.id}:${fu.lead_id}:w:0`,
        });
      }
    } catch {
      /* таблица может отсутствовать */
    }
  }

  for (const lead of newLeads ?? []) {
    if (tasks.length >= limit) break;
    const name = String(lead.name ?? '').trim() || 'Без имени';
    tasks.push({
      body: ['📨 Новая заявка', name, 'Нужно обработать новую заявку'].join('\n'),
      buttonText: '📨 Открыть заявку',
      callback: `al:l:${lead.id as string}:n:0:a`,
    });
  }

  if (tasks.length < limit) {
    try {
      const pending = await listPendingPurchaseRequests(admin);
      for (const req of pending.slice(0, limit - tasks.length)) {
        const name = (await memberName(admin, req.telegram_id)) || 'Ученик';
        tasks.push({
          body: ['💳 Ожидается оплата', `${name} · ${req.title}`, 'Нужно подтвердить или отклонить'].join('\n'),
          buttonText: '💳 Открыть оплату',
          callback: `ap:l:${req.id}:p:0`,
        });
      }
    } catch {
      /* таблица может отсутствовать */
    }
  }

  if (tasks.length < limit) {
    const { data: lowPkgs } = await admin
      .from('lesson_packages')
      .select('id, telegram_id, title, remaining_lessons')
      .eq('status', 'active')
      .lte('remaining_lessons', 2)
      .order('remaining_lessons', { ascending: true })
      .limit(limit - tasks.length);
    for (const pkg of lowPkgs ?? []) {
      const name = (await memberName(admin, pkg.telegram_id as number)) || 'Ученик';
      const title = String(pkg.title ?? 'пакет').trim();
      tasks.push({
        body: [
          '📦 Пакет заканчивается',
          `${name} · ${title}`,
          `Осталось ${pkg.remaining_lessons as number} занят.`,
        ].join('\n'),
        buttonText: '📦 Открыть пакет',
        callback: `apk:p:${pkg.id as number}:l:0`,
      });
    }
  }

  if (tasks.length < limit) {
    const cutoff = new Date(Date.now() - LONG_HW_MS).toISOString();
    const { data: hwRows } = await admin
      .from('homework_assignments')
      .select('id, telegram_id, submitted_at')
      .in('review_status', ['submitted', 'reviewing'])
      .lt('submitted_at', cutoff)
      .order('submitted_at', { ascending: true })
      .limit(limit - tasks.length);
    for (const row of hwRows ?? []) {
      const name = (await memberName(admin, row.telegram_id as number)) || 'Ученик';
      tasks.push({
        body: ['📚 Домашняя работа долго не проверяется', name, 'Нужна проверка преподавателем или куратором'].join(
          '\n',
        ),
        buttonText: '📚 Открыть ДЗ',
        callback: `ae:hw:v:${row.id as number}:long:0`,
      });
    }
  }

  if (tasks.length < limit) {
    const { data: activePkgs } = await admin
      .from('lesson_packages')
      .select('id, telegram_id, remaining_lessons')
      .eq('status', 'active')
      .limit(40);
    for (const pkg of activePkgs ?? []) {
      if (tasks.length >= limit) break;
      const scheduled = await countScheduledLessonsForPackage(admin, pkg.id as number);
      if (scheduled <= (pkg.remaining_lessons as number)) continue;
      const name = (await memberName(admin, pkg.telegram_id as number)) || 'Ученик';
      tasks.push({
        body: [
          '📅 Конфликт расписания',
          name,
          'Запланировано занятий больше, чем остаток на пакете',
        ].join('\n'),
        buttonText: '📅 Открыть пакет',
        callback: `apk:p:${pkg.id as number}:o:0`,
      });
      break;
    }
  }

  if (tasks.length < limit) {
    let pendingViolations = 0;
    try {
      pendingViolations = await countViolations(admin, { status: 'pending' });
    } catch {
      pendingViolations = 0;
    }
    if (pendingViolations > 0) {
      tasks.push({
        body: ['⚠️ Нарушения переписки', 'Есть новые жалобы модерации', 'Нужно просмотреть и принять решение'].join(
          '\n',
        ),
        buttonText: '⚠️ Открыть нарушения',
        callback: 'admin:mod:new:0',
      });
    }
  }

  return tasks.slice(0, limit);
}
