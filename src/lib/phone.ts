// Приведение номера к E.164 (+375291234567) — единое для клиента и сервера.
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{10,15}$/.test(clean)) return clean;
  const d = clean.replace(/\D/g, '');
  if (d.length === 9) return '+375' + d; // 29 123-45-67
  if (d.startsWith('375') && d.length === 12) return '+' + d;
  if (d.startsWith('80') && d.length === 11) return '+375' + d.slice(2); // 80(29)123-45-67
  if (d.startsWith('8') && d.length === 13) return '+375' + d.slice(1); // 8 029 123-45-67
  if (d.startsWith('7') && d.length === 11) return '+' + d; // 7 916 123-45-67
  return null;
}

// Живая маска поля ввода: форматирует только то, что пользователь набрал сам.
// 375... → 375 (XX) XXX XX XX, 8... → 80(XX) XXX XX XX,
// иначе цифры показываются как есть — без тихой подстановки префикса.
export function formatPhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return plus ? '+' : '';

  // Внутренний формат: 80(29) 123 45 67.
  if (digits[0] === '8') {
    const d = digits.slice(0, 11);
    if (d.length <= 2) return d;
    let out = '80';
    if (d.length > 2) out += `(${d.slice(2, 4)}`;
    if (d.length > 4) out += `) ${d.slice(4, 7)}`;
    if (d.length > 7) out += ` ${d.slice(7, 9)}`;
    if (d.length > 9) out += ` ${d.slice(9, 11)}`;
    return out;
  }

  // Международный формат: «+» ставим сами, как только начат набор (3… или +…).
  if (trimmed[0] === '+' || trimmed[0] === '3') {
    const d = digits.slice(0, 12);
    let out = '+';
    out += d.slice(0, 3);
    if (d.length > 3) out += ` (${d.slice(3, 5)}`;
    if (d.length > 5) out += `) ${d.slice(5, 8)}`;
    if (d.length > 8) out += ` ${d.slice(8, 10)}`;
    if (d.length > 10) out += ` ${d.slice(10, 12)}`;
    return out;
  }

  // Префикса пока нет — показываем набранные цифры как есть.
  return digits.slice(0, 12);
}

// Шаблоны масок: по ним рисуем полупрозрачный «хвост» после набранной части.
const PHONE_MASK_INT = '+375 (29) 123 45 67';
const PHONE_MASK_DOM = '80(29) 123 45 67';

// Остаток маски после уже набранного значения (для ghost-подсказки в поле).
export function phoneInputGhost(value: string): string {
  if (!value) return '';
  if (value.startsWith('+')) return PHONE_MASK_INT.slice(value.length);
  if (value.startsWith('8')) return PHONE_MASK_DOM.slice(value.length);
  return '';
}

// +375 29 123-45-67 для показа в сообщениях бота.
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ***-**-${d.slice(10)}`;
}
