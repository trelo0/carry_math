export function formatAdminMoney(amount: number): string {
  return `${Number(amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} BYN`;
}

export function formatAdminDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
