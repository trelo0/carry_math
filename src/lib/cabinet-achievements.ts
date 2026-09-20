import type { CabinetAchievementDef, CabinetAchievementRuleKey } from '@/lib/studio/cabinetSettings';
import type { CabinetData } from '@/lib/cabinet';

export type CabinetAchievementView = CabinetAchievementDef & {
  unlocked: boolean;
};

export function isAchievementUnlocked(ruleKey: CabinetAchievementRuleKey, data: CabinetData): boolean {
  const stops = data.courseStops;
  const doneCount = stops.filter((s) => s.status === 'done' || s.status === 'watched').length;
  const approvedHw = stops.filter((s) => s.homeworkStatus === 'approved').length;

  switch (ruleKey) {
    case 'lesson_1':
      return doneCount >= 1;
    case 'webinar_3':
      return doneCount >= 3;
    case 'hw_approved_1':
      return approvedHw >= 1;
    case 'score_100':
      return (
        data.profile?.resultType === 'ct' &&
        typeof data.profile.resultValue === 'number' &&
        data.profile.resultValue >= 100
      );
    default:
      return false;
  }
}

export function buildAchievementViews(data: CabinetData): CabinetAchievementView[] {
  return data.cabinetPricing.achievements.map((item) => ({
    ...item,
    unlocked: isAchievementUnlocked(item.ruleKey, data),
  }));
}
