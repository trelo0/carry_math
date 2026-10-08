/** Deep-link заявки с /individual: ?start=lead_<f><i>[_teacherId] (≤64 байт). */

export type LeadApplyFormat = 'individual' | 'group';
export type LeadApplyIntent = 'trial' | 'enroll';

export type LeadApplyParams = {
  format: LeadApplyFormat;
  intent: LeadApplyIntent;
  teacherId?: string;
};

export function buildLeadApplyStartParam(params: LeadApplyParams): string {
  const f = params.format === 'individual' ? 'i' : 'g';
  const i = params.intent === 'trial' ? 't' : 'e';
  const tid = (params.teacherId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return tid ? `lead_${f}${i}_${tid}` : `lead_${f}${i}`;
}

export function parseLeadApplyStartParam(start: string): LeadApplyParams | null {
  const match = /^lead_([ig])([te])(?:_([a-zA-Z0-9_-]+))?$/.exec(start.trim());
  if (!match) return null;
  return {
    format: match[1] === 'i' ? 'individual' : 'group',
    intent: match[2] === 't' ? 'trial' : 'enroll',
    teacherId: match[3] || undefined,
  };
}

export function buildLeadApplyTelegramUrl(params: LeadApplyParams): string {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (!bot) return '';
  return `https://t.me/${bot}?start=${buildLeadApplyStartParam(params)}`;
}

export function matchCabinetTeacherId(
  teacherName: string,
  cabinetTeachers: Array<{ teacherId: string; name: string }>,
): string | undefined {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .trim();

  const target = normalize(teacherName);
  if (!target) return undefined;

  const exact = cabinetTeachers.find((t) => normalize(t.name) === target);
  if (exact) return exact.teacherId;

  const targetParts = target.split(/\s+/).filter(Boolean);
  const byFirst = cabinetTeachers.find((t) => {
    const parts = normalize(t.name).split(/\s+/).filter(Boolean);
    return parts[0] && targetParts[0] && parts[0] === targetParts[0];
  });
  return byFirst?.teacherId;
}
