/** Склонение по правилам ru: 1 заявка, 2 заявки, 5 заявок. */
export function pluralRu(value: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(value));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function pluralRuWithCount(value: number, one: string, few: string, many: string): string {
  return `${value} ${pluralRu(value, one, few, many)}`;
}
