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

// Живая маска поля ввода: по мере набора приводит номер к виду
// +375 (XX) XXX-XX-XX или 80(XX)XXX-XX-XX.
export function formatPhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');

  // Внутренний формат: 80(29)123-45-67.
  if (trimmed[0] === '8') {
    const d = digits.slice(0, 11);
    if (d.length <= 1) return d;
    let out = '80';
    if (d.length > 2) out += `(${d.slice(2, 4)}`;
    if (d.length > 4) out += `)${d.slice(4, 7)}`;
    if (d.length > 7) out += `-${d.slice(7, 9)}`;
    if (d.length > 9) out += `-${d.slice(9, 11)}`;
    return out;
  }

  // Международный формат: +375 (29) 123-45-67.
  let d = digits;
  if (d.startsWith('0')) d = d.slice(1); // 029 123-45-67
  if (!d.startsWith('375')) d = '375' + d;
  d = d.slice(0, 12);

  let out = '+375';
  if (d.length > 3) out += ` (${d.slice(3, 5)}`;
  if (d.length > 5) out += `) ${d.slice(5, 8)}`;
  if (d.length > 8) out += `-${d.slice(8, 10)}`;
  if (d.length > 10) out += `-${d.slice(10, 12)}`;
  return out;
}

// +375 29 123-45-67 для показа в сообщениях бота.
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ***-**-${d.slice(10)}`;
}
