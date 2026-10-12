import type { CabinetAchievementDef } from '@/lib/studio/cabinetSettings';
import {
  normalizeAchievementRuleKey,
  type CabinetAchievementRuleKey,
} from '@/lib/cabinet-achievement-rules';
import { hasCoursePayment, type CabinetData } from '@/lib/cabinet';

export type CabinetAchievementView = CabinetAchievementDef & {
  unlocked: boolean;
};

function clearedLessonCount(data: CabinetData): number {
  return data.courseStops.filter((s) => s.status === 'done' || s.status === 'watched').length;
}

function clearedWebinarCount(data: CabinetData): number {
  return data.courseStops.filter(
    (s) =>
      s.kind === 'webinar' && (s.status === 'done' || s.status === 'watched'),
  ).length;
}

function approvedHomeworkCount(data: CabinetData): number {
  return data.courseStops.filter((s) => s.homeworkStatus === 'approved').length;
}

function submittedHomeworkCount(data: CabinetData): number {
  const fromStops = data.courseStops.filter(
    (s) =>
      s.homeworkStatus === 'submitted' ||
      s.homeworkStatus === 'approved' ||
      s.homeworkStatus === 'rejected',
  ).length;
  return Math.max(fromStops, data.achievementStats.homeworkSubmittedCount);
}

export function isAchievementUnlocked(ruleKey: CabinetAchievementRuleKey, data: CabinetData): boolean {
  if (!hasCoursePayment(data)) return false;

  const key = normalizeAchievementRuleKey(ruleKey);
  const lessonsDone = clearedLessonCount(data);
  const webinarsDone = clearedWebinarCount(data);
  const hwApproved = approvedHomeworkCount(data);
  const hwSubmitted = submittedHomeworkCount(data);
  const stats = data.achievementStats;

  switch (key) {
    case 'course_package_purchased':
      return hasCoursePayment(data);
    case 'course_enrolled':
      return data.enrollment != null;
    case 'course_map_viewed':
      return data.courseMapViewed;
    case 'lesson_complete_1':
      return lessonsDone >= 1;
    case 'lesson_complete_5':
      return lessonsDone >= 5;
    case 'lesson_complete_10':
      return lessonsDone >= 10;
    case 'webinar_complete_1':
      return webinarsDone >= 1;
    case 'webinar_complete_3':
      return webinarsDone >= 3;
    case 'hw_submitted_1':
      return hwSubmitted >= 1;
    case 'hw_approved_1':
      return hwApproved >= 1;
    case 'hw_approved_5':
      return hwApproved >= 5;
    case 'webinar_live_1':
      return stats.liveAttendedCount >= 1;
    case 'recording_watched_1':
      return stats.recordingWatchedCount >= 1;
    case 'curator_message_1':
      return stats.curatorMessagesSent >= 1;
    case 'profile_complete':
      return Boolean(
        data.profile?.klass?.trim() &&
          data.profile.resultType &&
          data.profile.resultValue != null,
      );
    case 'score_100':
      return (
        data.profile?.resultType === 'ct' &&
        typeof data.profile.resultValue === 'number' &&
        data.profile.resultValue >= 100
      );
    case 'individual_package_purchased':
      return data.packages.some(
        (p) =>
          (p.product === 'individual' || p.product === 'group') && p.total > 0,
      );
    case 'group_lesson_scheduled':
      return data.hasOrdinaryStudentTrack;
    case 'payment_success_1':
      return data.payments.some((p) => p.status === 'paid');
    default:
      return false;
  }
}

export function buildAchievementViews(data: CabinetData): CabinetAchievementView[] {
  const views = data.cabinetPricing.achievements.map((item) => ({
    ...item,
    unlocked: isAchievementUnlocked(item.ruleKey, data),
  }));
  return views.sort((a, b) => {
    if (a.unlocked === b.unlocked) return 0;
    return a.unlocked ? -1 : 1;
  });
}
