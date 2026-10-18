/** Deep-link сдачи ДЗ из кабинета: ?start=… (≤64 байт, только A-Za-z0-9_-). */

const HW_PREFIX = 'hw_';
const HWB_PREFIX = 'hwb_';
/** Статус / история сдачи ДЗ по вебинару (не hw_ — иначе пересечётся с сдачей). */
const HWS_PREFIX = 'hws_';
const HWSB_PREFIX = 'hwsb_';

function toBase64Url(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded + pad, 'base64').toString('utf8');
    }
    const binary = atob(padded + pad);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function telegramStartAllowsRaw(payload: string): boolean {
  return payload.length <= 64 && /^[A-Za-z0-9_-]+$/.test(payload);
}

function encodeLessonStart(prefix: string, b64Prefix: string, sanityLessonId: string): string {
  const raw = `${prefix}${sanityLessonId}`;
  if (telegramStartAllowsRaw(raw)) return raw;
  return `${b64Prefix}${toBase64Url(sanityLessonId)}`;
}

function parseLessonStart(source: string, prefix: string, b64Prefix: string): string | null {
  const token = source.trim();
  if (token.startsWith(b64Prefix)) {
    return fromBase64Url(token.slice(b64Prefix.length));
  }
  if (token.startsWith(prefix)) {
    return token.slice(prefix.length);
  }
  return null;
}

/** Параметр для https://t.me/bot?start=… */
export function buildCourseHomeworkTelegramStart(sanityLessonId: string): string {
  return encodeLessonStart(HW_PREFIX, HWB_PREFIX, sanityLessonId);
}

/** Deep-link статуса/истории сдачи ДЗ по вебинару. */
export function buildCourseHomeworkStatusTelegramStart(sanityLessonId: string): string {
  return encodeLessonStart(HWS_PREFIX, HWSB_PREFIX, sanityLessonId);
}

/** Sanity lesson id из /start сдачи или null. */
export function parseCourseHomeworkTelegramStart(source: string): string | null {
  return parseLessonStart(source, HW_PREFIX, HWB_PREFIX);
}

/** Sanity lesson id из /start статуса ДЗ или null. */
export function parseCourseHomeworkStatusTelegramStart(source: string): string | null {
  return parseLessonStart(source, HWS_PREFIX, HWSB_PREFIX);
}

/** Payload после /start (все форматы Telegram). null — не /start. */
export function extractBotStartPayload(text: string | undefined): string | null {
  if (!text?.startsWith('/start')) return null;

  let rest = text.slice('/start'.length).trim();
  if (!rest) return '';

  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space === -1) return '';
    rest = rest.slice(space + 1).trim();
  }
  if (!rest) return '';

  const atBot = rest.lastIndexOf('@');
  if (atBot > 0) {
    const suffix = rest.slice(atBot + 1);
    if (/^[A-Za-z0-9_]{3,64}$/.test(suffix)) {
      rest = rest.slice(0, atBot);
    }
  }

  return rest.trim();
}

export function isCourseHomeworkStartPayload(source: string): boolean {
  const t = source.trim();
  return t.startsWith(HW_PREFIX) || t.startsWith(HWB_PREFIX);
}

export function isCourseHomeworkStatusStartPayload(source: string): boolean {
  const t = source.trim();
  return t.startsWith(HWS_PREFIX) || t.startsWith(HWSB_PREFIX);
}

/** /start или /start@bot без параметра — не OTP-токен привязки. */
export function isPlainBotStartCommand(text: string | undefined): boolean {
  if (!text?.startsWith('/start')) return false;
  const payload = extractBotStartPayload(text);
  return payload !== null && payload === '';
}
