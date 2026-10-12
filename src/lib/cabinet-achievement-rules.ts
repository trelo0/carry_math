/** Правила разблокировки достижений кабинета (Sanity `ruleKey`). */
export const CABINET_ACHIEVEMENT_RULE_KEYS = [
  'course_package_purchased',
  'course_enrolled',
  'course_map_viewed',
  'lesson_complete_1',
  'lesson_complete_5',
  'lesson_complete_10',
  'webinar_complete_1',
  'webinar_complete_3',
  'hw_submitted_1',
  'hw_approved_1',
  'hw_approved_5',
  'webinar_live_1',
  'recording_watched_1',
  'curator_message_1',
  'profile_complete',
  'score_100',
  'individual_package_purchased',
  'group_lesson_scheduled',
  'payment_success_1',
  /** @deprecated Sanity legacy — alias для lesson_complete_1 */
  'lesson_1',
  /** @deprecated Sanity legacy — alias для webinar_complete_3 */
  'webinar_3',
] as const;

export type CabinetAchievementRuleKey = (typeof CABINET_ACHIEVEMENT_RULE_KEYS)[number];

const RULE_KEY_SET = new Set<string>(CABINET_ACHIEVEMENT_RULE_KEYS);

export function isCabinetAchievementRuleKey(value: string): value is CabinetAchievementRuleKey {
  return RULE_KEY_SET.has(value);
}

export function normalizeAchievementRuleKey(ruleKey: CabinetAchievementRuleKey): CabinetAchievementRuleKey {
  switch (ruleKey) {
    case 'lesson_1':
      return 'lesson_complete_1';
    case 'webinar_3':
      return 'webinar_complete_3';
    default:
      return ruleKey;
  }
}

export const CABINET_ACHIEVEMENT_RULE_LABELS: Record<CabinetAchievementRuleKey, string> = {
  course_package_purchased: 'Куплен пакет курса',
  course_enrolled: 'Записан на курс',
  course_map_viewed: 'Открыта карта курса',
  lesson_complete_1: 'Пройден 1 урок',
  lesson_complete_5: 'Пройдено 5 уроков',
  lesson_complete_10: 'Пройдено 10 уроков',
  webinar_complete_1: 'Просмотрен 1 вебинар',
  webinar_complete_3: 'Просмотрено 3 вебинара',
  hw_submitted_1: 'Сдано первое ДЗ',
  hw_approved_1: 'Первое ДЗ принято',
  hw_approved_5: 'Принято 5 ДЗ',
  webinar_live_1: 'Участие в эфире',
  recording_watched_1: 'Просмотр записи урока',
  curator_message_1: 'Первое сообщение куратору',
  profile_complete: 'Профиль заполнен',
  score_100: '100+ баллов РТ',
  individual_package_purchased: 'Куплен пакет занятий',
  group_lesson_scheduled: 'Запись на занятие',
  payment_success_1: 'Первая оплата',
  lesson_1: 'Пройден 1 урок (legacy)',
  webinar_3: '3 вебинара (legacy)',
};
