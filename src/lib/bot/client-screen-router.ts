import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotRole } from './roles';
import { showClientPaymentsHub, showClientMiscHub, showClientContactHub } from './client-shared-hubs';
import { showClientPurchaseHistory } from './client-purchase-history';
import { showClientApplicationsHub } from './client-my-leads';
import {
  showClientCourseHomeworkHistory,
  showClientCourseHomeworkHub,
  showClientCourseHomeworkLessonStatus,
  showClientHomeworkMenu,
} from './client-course-homework-hub';
import { showClientMyCourseHub, showClientCoursePicker } from './client-course-hub';
import { resolveClientState } from './client-state';
import { loadClientHubPayload, type ClientHubState } from './client-nav';
import { CLIENT_LESSONS_BOT_UI_ENABLED } from './client-lessons-ui-flag';

function splitHubScreenId(screenId: string): { base: string; param?: string } {
  if (screenId.startsWith('course-hw-hub:')) {
    return { base: 'course-hw-hub', param: screenId.slice('course-hw-hub:'.length) };
  }
  if (screenId.startsWith('course-hw-hist:')) {
    return { base: 'course-hw-hist', param: screenId.slice('course-hw-hist:'.length) };
  }
  if (screenId.startsWith('course-hw-lesson:')) {
    return { base: 'course-hw-lesson', param: screenId.slice('course-hw-lesson:'.length) };
  }
  return { base: screenId };
}

export type ClientScreenNavigateMode =
  | { kind: 'push'; chatId: number }
  | { kind: 'edit'; hub: ClientHubState; navStack?: string[] };

/** Вернуть ученика/гостя на экран по id из clientNavStack. */
export async function renderClientScreenById(
  admin: SupabaseClient,
  screenId: string,
  chatId: number,
  telegramId: number,
  memberRole: BotRole | undefined,
  mode: ClientScreenNavigateMode,
  extras?: {
    showOnlineCourse?: (mode: ClientScreenNavigateMode) => Promise<void>;
    showBuyCourseOffers?: (mode: ClientScreenNavigateMode) => Promise<void>;
  },
): Promise<void> {
  const editAt = mode.kind === 'edit' ? mode.hub : undefined;
  const deliver = mode.kind === 'push' ? { forcePush: true } : { editAt };

  const state = await resolveClientState(admin, telegramId, { memberRole });
  const hubPayload = await loadClientHubPayload(admin, telegramId);
  const activeCourseSlug = hubPayload?.payload.activeCourseSlug;
  const { base, param } = splitHubScreenId(screenId);

  switch (base) {
    case 'payments-hub':
      await showClientPaymentsHub(admin, telegramId, chatId, deliver);
      return;
    case 'misc-hub':
      await showClientMiscHub(admin, telegramId, chatId, deliver);
      return;
    case 'contact-hub':
      await showClientContactHub(admin, telegramId, chatId, deliver);
      return;
    case 'purchase-history':
    case 'purchase-history-empty':
      await showClientPurchaseHistory(admin, telegramId, chatId, deliver);
      return;
    case 'my-leads':
      await showClientApplicationsHub(admin, telegramId, chatId, deliver);
      return;
    case 'course-hw-root':
      await showClientHomeworkMenu(admin, telegramId, chatId, deliver);
      return;
    case 'course-hw-hub':
      await showClientCourseHomeworkHub(
        admin,
        telegramId,
        chatId,
        deliver,
        param || activeCourseSlug,
      );
      return;
    case 'course-hw-hist':
      await showClientCourseHomeworkHistory(
        admin,
        telegramId,
        chatId,
        deliver,
        param || activeCourseSlug,
      );
      return;
    case 'course-hw-lesson':
      if (param) {
        await showClientCourseHomeworkLessonStatus(admin, telegramId, chatId, param, deliver);
      } else {
        await showClientCourseHomeworkHistory(
          admin,
          telegramId,
          chatId,
          deliver,
          activeCourseSlug,
        );
      }
      return;
    case 'my-course':
    case 'my-course-detail':
      await showClientMyCourseHub(admin, telegramId, chatId, deliver, activeCourseSlug);
      return;
    case 'my-course-pick':
      await showClientCoursePicker(admin, telegramId, chatId, deliver);
      return;
    case 'schedule-list':
    case 'schedule-empty':
    case 'package-list':
    case 'package-empty':
    case 'lessons-menu':
    case 'buy-education':
    case 'buy-lessons':
    case 'lessons':
    case 'lesson-individual':
    case 'lesson-group':
      if (CLIENT_LESSONS_BOT_UI_ENABLED) {
        const { showClientScheduleMenu, showClientPackageMenu, showClientLessonsMenu } =
          await import('./client-lessons-flow');
        if (base === 'schedule-list' || base === 'schedule-empty') {
          await showClientScheduleMenu(admin, telegramId, chatId, deliver);
          return;
        }
        if (base === 'package-list' || base === 'package-empty') {
          await showClientPackageMenu(admin, telegramId, chatId, deliver);
          return;
        }
        if (base === 'lessons-menu') {
          await showClientLessonsMenu(admin, telegramId, chatId, state, deliver);
          return;
        }
      }
      await extras?.showBuyCourseOffers?.(mode);
      return;
    case 'buy-course-offers':
      await extras?.showBuyCourseOffers?.(mode);
      return;
    case 'course':
    case 'guest-course-detail':
      await extras?.showOnlineCourse?.(mode);
      return;
    case 'home':
    default:
      if (mode.kind === 'edit') {
        const { editClientCard } = await import('./client-nav');
        await editClientCard(
          admin,
          telegramId,
          mode.hub,
          'home',
          'Выберите раздел в меню под полем ввода.',
          { inline_keyboard: [] },
          mode.navStack,
        );
      }
      return;
  }
}
