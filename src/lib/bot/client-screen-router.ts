import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotRole } from './roles';
import { showClientPaymentsHub, showClientMiscHub, showClientContactHub } from './client-shared-hubs';
import { showClientPurchaseHistory } from './client-purchase-history';
import { showClientApplicationsHub } from './client-my-leads';
import { showClientCourseHomeworkHub } from './client-course-homework-hub';
import { showClientMyCourseHub, showClientCoursePicker } from './client-course-hub';
import { showClientScheduleMenu, showClientPackageMenu, showClientLessonsMenu } from './client-lessons-flow';
import { resolveClientState } from './client-state';
import type { ClientHubState } from './client-nav';

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
    showBuyEducation?: (mode: ClientScreenNavigateMode) => Promise<void>;
    showOnlineCourse?: (mode: ClientScreenNavigateMode) => Promise<void>;
    showLessonsHub?: (mode: ClientScreenNavigateMode) => Promise<void>;
    showLessonFormat?: (format: 'individual' | 'group', mode: ClientScreenNavigateMode) => Promise<void>;
    showBuyCourseOffers?: (mode: ClientScreenNavigateMode) => Promise<void>;
    showBuyLessons?: (mode: ClientScreenNavigateMode) => Promise<void>;
  },
): Promise<void> {
  const editAt = mode.kind === 'edit' ? mode.hub : undefined;
  const deliver = mode.kind === 'push' ? { forcePush: true } : { editAt };

  const state = await resolveClientState(admin, telegramId, { memberRole });

  switch (screenId) {
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
    case 'course-hw-hub':
      await showClientCourseHomeworkHub(admin, telegramId, chatId, deliver);
      return;
    case 'my-course':
    case 'my-course-detail':
      await showClientMyCourseHub(admin, telegramId, chatId, deliver);
      return;
    case 'my-course-pick':
      await showClientCoursePicker(admin, telegramId, chatId, deliver);
      return;
    case 'schedule-list':
    case 'schedule-empty':
      await showClientScheduleMenu(admin, telegramId, chatId, deliver);
      return;
    case 'package-list':
    case 'package-empty':
      await showClientPackageMenu(admin, telegramId, chatId, deliver);
      return;
    case 'lessons-menu':
      await showClientLessonsMenu(admin, telegramId, chatId, state, deliver);
      return;
    case 'buy-education':
      await extras?.showBuyEducation?.(mode);
      return;
    case 'buy-lessons':
      await extras?.showBuyLessons?.(mode);
      return;
    case 'buy-course-offers':
      await extras?.showBuyCourseOffers?.(mode);
      return;
    case 'course':
    case 'guest-course-detail':
      await extras?.showOnlineCourse?.(mode);
      return;
    case 'lessons':
      await extras?.showLessonsHub?.(mode);
      return;
    case 'lesson-individual':
      await extras?.showLessonFormat?.('individual', mode);
      return;
    case 'lesson-group':
      await extras?.showLessonFormat?.('group', mode);
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
