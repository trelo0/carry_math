export type ReportPeriodPreset = 'today' | '7d' | '30d' | 'month' | 'custom';

const MS_DAY = 86400000;
const MSK_OFFSET = 3 * 3600000;

export function mskMidnightMs(from = Date.now()): number {
  return Math.floor((from + MSK_OFFSET) / MS_DAY) * MS_DAY - MSK_OFFSET;
}

export function periodBounds(preset: ReportPeriodPreset, custom?: { fromMs: number; toMs: number }): {
  fromIso: string;
  toIso: string;
  label: string;
} {
  const endMs = mskMidnightMs() + MS_DAY;
  let fromMs = mskMidnightMs();

  if (preset === '7d') fromMs = mskMidnightMs() - 6 * MS_DAY;
  else if (preset === '30d') fromMs = mskMidnightMs() - 29 * MS_DAY;
  else if (preset === 'month') {
    const d = new Date(mskMidnightMs());
    d.setUTCDate(1);
    fromMs = d.getTime();
  } else if (preset === 'custom' && custom) {
    fromMs = custom.fromMs;
    const toExclusive = custom.toMs + MS_DAY;
    return {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toExclusive).toISOString(),
      label: formatRangeLabel(fromMs, custom.toMs),
    };
  }

  const from = new Date(fromMs);
  const end = new Date(endMs);
  const label =
    preset === 'today'
      ? from.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' })
      : `${from.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })} — ${new Date(endMs - 1).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })}`;

  return { fromIso: from.toISOString(), toIso: end.toISOString(), label };
}

function formatRangeLabel(fromMs: number, toMs: number): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });
  return `${f(fromMs)} — ${f(toMs)}`;
}

/** DD.MM.YYYY или DD.MM — дата начала/конца периода (MSK midnight). */
export function parseReportDate(text: string): number | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const utcGuess = Date.UTC(year, month - 1, day);
  const mskMidnight = utcGuess - MSK_OFFSET;
  return mskMidnight;
}
