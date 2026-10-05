/** Точная отмена диалога (заявка, поддержка). */
export function isClientCancelText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === 'отмена' || t === 'cancel';
}

/** Похоже на отмену с опечаткой — не ломаем сценарий. */
export function isClientCancelTypo(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (isClientCancelText(text)) return false;
  return t.startsWith('отмен') || t === 'отменить';
}

export const CLIENT_CANCEL_HINT =
  'Чтобы прервать диалог, напишите «Отмена» без опечаток. Или продолжайте ответ на вопрос бота.';
