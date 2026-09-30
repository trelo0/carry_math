const KNOWN: Record<string, string> = {
  Unauthorized: 'Сессия истекла — обновите страницу и войдите снова',
  Forbidden: 'Нет доступа к этому занятию',
  'Lesson not found': 'Занятие не найдено',
  'Invalid lesson id': 'Некорректный идентификатор занятия',
  'File required': 'Выберите файл для загрузки',
  'Material not found': 'Файл не найден',
};

/** Человекочитаемое сообщение из ответа API расписания. */
export function formatScheduleApiError(
  message: string | undefined,
  fallback: string,
  status?: number,
): string {
  if (message?.trim()) {
    const trimmed = message.trim();
    if (KNOWN[trimmed]) return KNOWN[trimmed];
    if (trimmed.includes('scheduled_lessons_individual_no_overlap_per_teacher')) {
      return 'У вас уже есть индивидуальное занятие в это время';
    }
    return trimmed;
  }
  if (status === 409) return 'Это время уже занято или пересекается с другим событием';
  if (status === 401) return KNOWN.Unauthorized;
  if (status === 403) return KNOWN.Forbidden;
  if (status === 404) return 'Запись не найдена — обновите календарь';
  return fallback;
}
