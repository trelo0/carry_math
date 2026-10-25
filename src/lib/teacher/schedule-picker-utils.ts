import { dateKey } from '@/lib/teacher/schedule-utils';

export type PickerOption = {
  value: string;
  label: string;
  sub?: string;
  disabled?: boolean;
};

export function parseTimeParts(value: string): { hour: number; minute: number } {
  const [hh, mm] = (value || '00:00').split(':');
  const hour = Math.min(23, Math.max(0, Number(hh) || 0));
  const minute = Math.min(59, Math.max(0, Number(mm) || 0));
  return { hour, minute };
}

export function formatTimeParts(hour: number, minute: number): string {
  const h = Math.min(23, Math.max(0, hour));
  const m = Math.min(59, Math.max(0, minute));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Список времён для выпадающего меню (шаг 15 мин по умолчанию). */
export function buildTimeOptions(minuteStep = 15): PickerOption[] {
  const step = Math.max(1, Math.min(30, Math.floor(minuteStep) || 15));
  const options: PickerOption[] = [];
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += step) {
      const value = formatTimeParts(h, m);
      options.push({ value, label: value });
    }
  }
  return options;
}

export function buildMinuteOptions(step: number): number[] {
  const safe = Math.max(1, Math.min(30, Math.floor(step) || 1));
  const list: number[] = [];
  for (let m = 0; m < 60; m += safe) list.push(m);
  return list;
}

export function snapMinuteToStep(minute: number, step: number): number {
  const options = buildMinuteOptions(step);
  if (options.includes(minute)) return minute;
  let best = options[0];
  let dist = Math.abs(minute - best);
  for (const m of options) {
    const d = Math.abs(minute - m);
    if (d < dist) {
      dist = d;
      best = m;
    }
  }
  return best;
}

/** Ручной ввод: «13:17», «1317», «9:5». null — не удалось разобрать. */
export function parseManualTime(raw: string, minuteStep = 1): string | null {
  const t = raw.trim().replace(/\s/g, '');
  if (!t) return null;

  let hour: number;
  let minute: number;

  const colon = /^(\d{1,2})[:.](\d{1,2})$/.exec(t);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (/^\d{3,4}$/.test(t)) {
    const padded = t.padStart(4, '0');
    hour = Number(padded.slice(0, -2));
    minute = Number(padded.slice(-2));
  } else if (/^\d{1,2}$/.test(t)) {
    hour = Number(t);
    minute = 0;
  } else {
    return null;
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null;
  }

  const m = minuteStep > 1 ? snapMinuteToStep(minute, minuteStep) : minute;
  return formatTimeParts(hour, m);
}

export function buildDateOptions(minKey: string, count = 90): PickerOption[] {
  const [y, m, d] = minKey.split('-').map(Number);
  const cursor = new Date(y, (m || 1) - 1, d || 1);
  const options: PickerOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = dateKey(cursor);
    const isToday = i === 0 && key === minKey;
    options.push({
      value: key,
      label: cursor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
      sub: isToday ? 'Сегодня' : cursor.toLocaleDateString('ru-RU', { weekday: 'long' }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return options;
}
