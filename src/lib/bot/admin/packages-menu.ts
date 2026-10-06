import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCESS_PRODUCT_LABELS, type AccessProduct } from '../accesses';
import { isPackageTableError } from '../packages';
import { countScheduledLessonsForPackage } from '../lesson-credits';
import { syncPackageUsage } from '../lessons';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  migrationText,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import { logAdminAction } from './action-log';
import { getMember } from '@/lib/bot/roles';

export type PackageFilter = 'low' | 'over' | 'active' | 'all' | 'ended';

type PackageRow = {
  id: number;
  telegram_id: number;
  product: string;
  title: string;
  total_lessons: number;
  used_lessons: number | null;
  remaining_lessons: number;
  status: string;
  purchased_at: string;
};

const PACKAGES_PER_PAGE = 6;

const FILTER_CODE: Record<PackageFilter, string> = {
  low: 'l',
  over: 'o',
  active: 'a',
  all: 'z',
  ended: 'e',
};

async function countPackagesByBucket(admin: SupabaseClient): Promise<{ active: number; ending: number; ended: number }> {
  const threshold = Number(process.env.FINANCE_PACKAGE_ENDING_THRESHOLD ?? '2');
  const endingMax = Number.isFinite(threshold) ? threshold : 2;
  const [active, ending, ended] = await Promise.all([
    admin
      .from('lesson_packages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gt('remaining_lessons', endingMax),
    admin
      .from('lesson_packages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .lte('remaining_lessons', endingMax)
      .gt('remaining_lessons', 0),
    admin
      .from('lesson_packages')
      .select('id', { count: 'exact', head: true })
      .or('status.eq.completed,remaining_lessons.eq.0'),
  ]);
  return { active: active.count ?? 0, ending: ending.count ?? 0, ended: ended.count ?? 0 };
}

export async function renderPackagesHub(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const c = await countPackagesByBucket(admin);
  const btn = (label: string, count: number, cb: string) => ({
    text: count > 0 ? `${label} · ${count}` : label,
    callback_data: cb,
  });
  await deliver(
    [
      '📦 Пакеты',
      '',
      `🟢 Активные — ${c.active}`,
      `🟡 Заканчиваются — ${c.ending}`,
      `🔴 Закончились — ${c.ended}`,
    ].join('\n'),
    {
      inline_keyboard: [
        [btn('🟢 Активные', c.active, 'apk:f:a:0')],
        [btn('🟡 Заканчиваются', c.ending, 'apk:f:l:0')],
        [btn('🔴 Закончились', c.ended, 'apk:f:e:0')],
        [{ text: '⬅️ Финансы', callback_data: 'af:menu' }],
        [homeButton()],
      ],
    },
  );
}

const PACKAGE_COLUMNS =
  'id, telegram_id, product, title, total_lessons, used_lessons, remaining_lessons, status, purchased_at';

function filterFromCode(code: string | undefined): PackageFilter {
  const found = (Object.keys(FILTER_CODE) as PackageFilter[]).find((k) => FILTER_CODE[k] === code);
  return found ?? 'low';
}

function codeFromFilter(filter: PackageFilter): string {
  return FILTER_CODE[filter];
}

function navSuffix(filter: PackageFilter, page: number): string {
  return `${codeFromFilter(filter)}:${page}`;
}

function productLabel(product: string): string {
  if (product in ACCESS_PRODUCT_LABELS) return ACCESS_PRODUCT_LABELS[product as AccessProduct];
  return product;
}

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  return member ? memberDisplayName(member) : `ID ${telegramId}`;
}

async function loadLowPackages(admin: SupabaseClient): Promise<PackageRow[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select(PACKAGE_COLUMNS)
    .eq('status', 'active')
    .lte('remaining_lessons', 2)
    .order('remaining_lessons', { ascending: true })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as PackageRow[];
}

async function loadActivePackages(admin: SupabaseClient): Promise<PackageRow[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select(PACKAGE_COLUMNS)
    .eq('status', 'active')
    .order('purchased_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as PackageRow[];
}

async function loadEndedPackages(admin: SupabaseClient): Promise<PackageRow[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select(PACKAGE_COLUMNS)
    .or('status.eq.completed,remaining_lessons.eq.0')
    .order('purchased_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as PackageRow[];
}

async function loadAllPackages(admin: SupabaseClient): Promise<PackageRow[]> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select(PACKAGE_COLUMNS)
    .order('purchased_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as PackageRow[];
}

async function loadOverbookedPackages(admin: SupabaseClient): Promise<Array<PackageRow & { scheduled: number }>> {
  const active = await loadActivePackages(admin);
  const out: Array<PackageRow & { scheduled: number }> = [];
  for (const pkg of active) {
    const scheduled = await countScheduledLessonsForPackage(admin, pkg.id);
    if (scheduled > pkg.remaining_lessons) {
      out.push({ ...pkg, scheduled });
    }
  }
  return out;
}

async function getPackage(admin: SupabaseClient, id: number): Promise<PackageRow | null> {
  const { data, error } = await admin.from('lesson_packages').select(PACKAGE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as PackageRow) : null;
}

async function adjustRemaining(admin: SupabaseClient, packageId: number, delta: number): Promise<boolean> {
  const pkg = await getPackage(admin, packageId);
  if (!pkg || pkg.status !== 'active') return false;
  const next = Math.max(0, pkg.remaining_lessons + delta);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('lesson_packages')
    .update({ remaining_lessons: next, updated_at: now })
    .eq('id', packageId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

function packageListLine(
  pkg: PackageRow,
  index: number,
  scheduled?: number,
): string {
  const sched = scheduled != null ? ` · 📅 ${scheduled} в расписании` : '';
  return `${index}. #${pkg.id} · ${productLabel(pkg.product)} · остаток ${pkg.remaining_lessons}/${pkg.total_lessons}${sched}`;
}

async function renderPackagesScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: PackageFilter,
  page: number,
): Promise<void> {
  let items: Array<PackageRow & { scheduled?: number }> = [];
  if (filter === 'low') items = await loadLowPackages(admin);
  else if (filter === 'active') items = await loadActivePackages(admin);
  else if (filter === 'all') items = await loadAllPackages(admin);
  else if (filter === 'ended') items = await loadEndedPackages(admin);
  else items = await loadOverbookedPackages(admin);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / PACKAGES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = items.slice(safePage * PACKAGES_PER_PAGE, (safePage + 1) * PACKAGES_PER_PAGE);
  const nav = navSuffix(filter, safePage);

  const filterBtn = (f: PackageFilter, label: string): InlineButton => ({
    text: `${filter === f ? '✅ ' : ''}${label}`,
    callback_data: `apk:f:${navSuffix(f, 0)}`,
  });

  const keyboard: InlineButton[][] = [
    [filterBtn('active', '🟢 Активные'), filterBtn('low', '🟡 Заканчиваются')],
    [filterBtn('ended', '🔴 Закончились'), filterBtn('over', '⚠️ Перебор')],
  ];

  for (const pkg of slice) {
    const student = await memberLabel(admin, pkg.telegram_id);
    keyboard.push([
      {
        text: `${shorten(student, 14)} · ${pkg.remaining_lessons}/${pkg.total_lessons}`,
        callback_data: `apk:p:${pkg.id}:${nav}`,
      },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `apk:f:${navSuffix(filter, safePage - 1)}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `apk:f:${navSuffix(filter, safePage + 1)}` : 'noop',
      },
    ]);
  }

  keyboard.push([{ text: '⬅️ Пакеты', callback_data: 'apk:hub' }, { text: '💳 Финансы', callback_data: 'af:menu' }], [homeButton()]);

  const titles: Record<PackageFilter, string> = {
    low: '🟡 Пакеты заканчиваются',
    over: '⚠️ Запланировано больше, чем остаток',
    active: '🟢 Активные пакеты',
    ended: '🔴 Закончившиеся пакеты',
    all: '📋 Все пакеты (последние)',
  };

  const lines =
    slice.length === 0
      ? [`${titles[filter]}`, '', 'Список пуст.']
      : [
          titles[filter],
          '',
          ...(await Promise.all(
            slice.map(async (pkg, i) => {
              const student = await memberLabel(admin, pkg.telegram_id);
              return `${packageListLine(pkg, safePage * PACKAGES_PER_PAGE + i + 1, pkg.scheduled)}\n   👤 ${student}`;
            }),
          )),
        ];

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

export async function renderPackagesMenu(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: PackageFilter = 'active',
): Promise<void> {
  await renderPackagesScreen(admin, deliver, filter, 0);
}

async function renderPackageDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  pkg: PackageRow,
  filter: PackageFilter,
  page: number,
): Promise<void> {
  const scheduled = await countScheduledLessonsForPackage(admin, pkg.id);
  const used = pkg.used_lessons ?? Math.max(0, pkg.total_lessons - pkg.remaining_lessons);
  const student = await memberLabel(admin, pkg.telegram_id);
  const nav = navSuffix(filter, page);

  const lines = [
    `📦 Пакет #${pkg.id}`,
    '',
    `👤 ${student}`,
    `📚 ${productLabel(pkg.product)}`,
    pkg.title ? `📝 ${pkg.title}` : '',
    `Всего: ${pkg.total_lessons} · использовано: ${used} · остаток: ${pkg.remaining_lessons}`,
    `📅 В расписании (scheduled): ${scheduled}`,
    scheduled > pkg.remaining_lessons ? '⚠️ Запланировано больше, чем остаток на пакете.' : '',
    `Статус: ${pkg.status}`,
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [
    [
      { text: '➖ −1', callback_data: `apk:adj:${pkg.id}:-1:${nav}` },
      { text: '➕ +1', callback_data: `apk:adj:${pkg.id}:1:${nav}` },
    ],
    [{ text: '🔄 Пересчитать по занятиям', callback_data: `apk:sync:${pkg.id}:${nav}` }],
    [{ text: '👤 Карточка ученика', callback_data: `admin:user:${pkg.telegram_id}::` }],
    [{ text: '◀️ К списку', callback_data: `apk:f:${nav}` }],
    [homeButton()],
  ];

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderStudentPackages(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select(PACKAGE_COLUMNS)
    .eq('telegram_id', telegramId)
    .order('purchased_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const packages = (data ?? []) as unknown as PackageRow[];
  const student = await memberLabel(admin, telegramId);

  const keyboard: InlineButton[][] = packages.map((pkg) => [
    {
      text: `#${pkg.id} · ${productLabel(pkg.product)} · ${pkg.remaining_lessons}/${pkg.total_lessons}`,
      callback_data: `apk:p:${pkg.id}:${navSuffix('all', 0)}`,
    },
  ]);
  keyboard.push(
    [{ text: '↩️ К профилю', callback_data: `admin:user:${telegramId}::` }],
    [homeButton()],
  );

  const text =
    packages.length === 0
      ? `📦 Пакеты\n\n${student}\n\nАктивных записей нет.`
      : ['📦 Пакеты', '', student, '', ...packages.map((p, i) => packageListLine(p, i + 1))].join('\n');

  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

export function isPackagesAction(data: string): boolean {
  return data.startsWith('apk:');
}

export async function handlePackagesAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  try {
    if (data === 'apk:menu' || data === 'apk:hub') {
      await renderPackagesHub(admin, deliver);
      return true;
    }

    if (data.startsWith('apk:f:')) {
      const parts = data.slice('apk:f:'.length).split(':');
      const filter = filterFromCode(parts[0]);
      const page = Math.max(0, Number(parts[1]) || 0);
      await renderPackagesScreen(admin, deliver, filter, page);
      return true;
    }

    const stuMatch = data.match(/^apk:stu:(\d+)$/);
    if (stuMatch) {
      await renderStudentPackages(admin, message, Number(stuMatch[1]));
      return true;
    }

    const pkgMatch = data.match(/^apk:p:(\d+):([a-z]):(\d+)$/);
    if (pkgMatch) {
      const pkg = await getPackage(admin, Number(pkgMatch[1]));
      if (!pkg) {
        await deliver('Пакет не найден.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderPackageDetail(admin, message, pkg, filterFromCode(pkgMatch[2]), Number(pkgMatch[3]) || 0);
      return true;
    }

    const syncMatch = data.match(/^apk:sync:(\d+):([a-z]):(\d+)$/);
    if (syncMatch) {
      const packageId = Number(syncMatch[1]);
      await syncPackageUsage(admin, packageId);
      await logAdminAction(admin, {
        actorTelegramId,
        action: 'package.sync',
        entityType: 'lesson_package',
        entityId: packageId,
        targetTelegramId: (await getPackage(admin, packageId))?.telegram_id,
      });
      const pkg = await getPackage(admin, packageId);
      if (!pkg) {
        await deliver('Пакет не найден.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderPackageDetail(admin, message, pkg, filterFromCode(syncMatch[2]), Number(syncMatch[3]) || 0);
      return true;
    }

    const adjMatch = data.match(/^apk:adj:(\d+):(-?\d+):([a-z]):(\d+)$/);
    if (adjMatch) {
      const packageId = Number(adjMatch[1]);
      const delta = Number(adjMatch[2]);
      const before = await getPackage(admin, packageId);
      await adjustRemaining(admin, packageId, delta);
      const pkg = await getPackage(admin, packageId);
      if (before) {
        await logAdminAction(admin, {
          actorTelegramId,
          action: 'package.adjust',
          entityType: 'lesson_package',
          entityId: packageId,
          targetTelegramId: before.telegram_id,
          detail: { delta, from: before.remaining_lessons, to: pkg?.remaining_lessons },
        });
      }
      if (!pkg) {
        await deliver('Пакет не найден.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderPackageDetail(admin, message, pkg, filterFromCode(adjMatch[3]), Number(adjMatch[4]) || 0);
      return true;
    }
  } catch (error) {
    if (isPackageTableError(error)) {
      await deliver(migrationText('cabinet_data.sql'), homeOnlyKeyboard());
      return true;
    }
    console.error('[admin packages]', error);
    await deliver('❌ Не удалось загрузить пакеты.', homeOnlyKeyboard());
    return true;
  }

  return false;
}
