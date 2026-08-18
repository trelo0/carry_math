import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Одноразовый 6-значный код.
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function pepper(): string {
  return process.env.OTP_PEPPER || 'dev-otp-pepper';
}

// Код хранится только в виде HMAC-независимого sha256-хэша с перцем.
export function hashOtp(code: string): string {
  return createHash('sha256').update(`${code}.${pepper()}`).digest('hex');
}

export function verifyOtpHash(code: string, hash: string): boolean {
  const a = Buffer.from(hashOtp(code), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Одноразовый токен привязки Telegram (передаётся в deep-link бота).
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}
