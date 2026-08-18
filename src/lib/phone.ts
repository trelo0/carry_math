// Приведение номера к E.164 (+375291234567) — единое для клиента и сервера.
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{10,15}$/.test(clean)) return clean;
  const d = clean.replace(/\D/g, '');
  if (d.length === 9) return '+375' + d; // 29 123-45-67
  if (d.startsWith('375') && d.length === 12) return '+' + d;
  if (d.startsWith('8') && d.length === 13) return '+375' + d.slice(1); // 8 029 123-45-67
  if (d.startsWith('7') && d.length === 11) return '+' + d; // 7 916 123-45-67
  return null;
}

// +375 29 123-45-67 для показа в сообщениях бота.
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ***-**-${d.slice(10)}`;
}
