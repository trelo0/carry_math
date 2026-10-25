import { buildLocalIso, dateKey } from '@/lib/teacher/schedule-utils';

export const SERIES_DEFAULT_WEEKS = 12;

/** День недели в формате расписания: 0 = Пн … 6 = Вс. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * Даты занятий серии: каждая выбранная неделя-день начиная с fromDate включительно
 * (в пределах `weeks` недель). Прошедшее время пропускается.
 */
export function buildSeriesOccurrences(params: {
  fromDate: string;
  weekdays: number[];
  /** Одно время для всех дней (если нет weekdayTimes). */
  startTime?: string;
  /** Время по дню недели: 0 = Пн … 6 = Вс. */
  weekdayTimes?: Partial<Record<number, string>>;
  weeks?: number;
  nowMs?: number;
}): string[] {
  const weeks = Math.max(1, params.weeks ?? SERIES_DEFAULT_WEEKS);
  const [y, m, d] = params.fromDate.split('-').map(Number);
  if (!y || !m || !d) return [];
  const wanted = new Set(params.weekdays);
  const nowMs = params.nowMs ?? Date.now();
  const result: string[] = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const day = new Date(y, m - 1, d + offset);
    const wd = weekdayIndex(day);
    if (!wanted.has(wd)) continue;
    const time = params.weekdayTimes?.[wd] ?? params.startTime;
    if (!time) continue;
    const startsAt = buildLocalIso(dateKey(day), time);
    if (new Date(startsAt).getTime() <= nowMs) continue;
    result.push(startsAt);
  }
  return result;
}
