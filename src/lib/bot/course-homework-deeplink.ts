/** Deep-link сдачи ДЗ из кабинета: ?start=… (≤64 байт, только A-Za-z0-9_-). */

const HW_PREFIX = 'hw_';
const HWB_PREFIX = 'hwb_';

function toBase64Url(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64url');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(value, 'base64url').toString('utf8');
    }
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
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

/** Параметр для https://t.me/bot?start=… */
export function buildCourseHomeworkTelegramStart(sanityLessonId: string): string {
  const raw = `${HW_PREFIX}${sanityLessonId}`;
  if (telegramStartAllowsRaw(raw)) return raw;
  return `${HWB_PREFIX}${toBase64Url(sanityLessonId)}`;
}

/** Sanity lesson id из /start или null. */
export function parseCourseHomeworkTelegramStart(source: string): string | null {
  const token = source.trim();
  if (token.startsWith(HWB_PREFIX)) {
    return fromBase64Url(token.slice(HWB_PREFIX.length));
  }
  if (token.startsWith(HW_PREFIX)) {
    return token.slice(HW_PREFIX.length);
  }
  return null;
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

/** /start или /start@bot без параметра — не OTP-токен привязки. */
export function isPlainBotStartCommand(text: string | undefined): boolean {
  if (!text?.startsWith('/start')) return false;
  const payload = extractBotStartPayload(text);
  return payload !== null && payload === '';
}
