/** Статус оплаты в кабинете препода: отметка админа, не платёж ученика. */
export function teacherLessonPaymentStatusLabel(isPaid: boolean | null | undefined): string | null {
  if (isPaid === true) return 'Оплата отмечена';
  if (isPaid === false) return 'Ждёт отметку об оплате';
  return null;
}

export function teacherLessonPaymentChipShort(isPaid: boolean | null | undefined): 'paid' | 'unpaid' | null {
  if (isPaid === true) return 'paid';
  if (isPaid === false) return 'unpaid';
  return null;
}

export function teacherLessonPaymentChipAria(kind: 'paid' | 'unpaid'): string {
  return kind === 'paid' ? 'Оплата отмечена администратором' : 'Ожидает отметку об оплате';
}
