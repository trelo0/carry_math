/**
 * Политика времени расписания District:
 * календарная дата и часы — «настенные часы» преподавателя (по умолчанию UTC+3).
 * В БД хранится timestamptz (UTC); конвертация через фиксированное смещение, не через TZ сервера.
 */
const DEFAULT_OFFSET_MIN = 180;

export function scheduleUtcOffsetMinutes(): number {
  const raw = process.env.SCHEDULE_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_SCHEDULE_TZ_OFFSET_MINUTES;
  const n = raw != null ? Number(raw) : DEFAULT_OFFSET_MIN;
  return Number.isFinite(n) ? n : DEFAULT_OFFSET_MIN;
}

export type WallClock = { dateKey: string; time: string };

/** ISO → календарная дата и HH:mm в зоне расписания. */
export function wallClockFromIso(iso: string): WallClock {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return { dateKey: '1970-01-01', time: '00:00' };
  }
  const offsetMs = scheduleUtcOffsetMinutes() * 60_000;
  const local = new Date(t + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  const hh = local.getUTCHours();
  const mm = local.getUTCMinutes();
  return {
    dateKey: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  };
}

/** Календарная дата + время → ISO (UTC instant). */
export function buildScheduleIso(dateKeyStr: string, time: string): string {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const offsetMs = scheduleUtcOffsetMinutes() * 60_000;
  const utcMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0) - offsetMs;
  return new Date(utcMs).toISOString();
}

/** Date для вычисления дня недели (локальные y-m-d, без сдвига UTC). */
export function wallClockToLocalDate(dateKeyStr: string): Date {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
