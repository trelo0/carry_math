import type { AdminUserEventKind } from '@/lib/bot/admin/user-activity-notify';
import { ADMIN_ACTIVITY_NOTIFICATION_KINDS } from '@/lib/bot/admin/user-activity-settings';

export type ActivityNotificationCard = {
  kind: AdminUserEventKind;
  emoji: string;
  title: string;
  description: string;
  accent: 'mint' | 'sky' | 'violet' | 'amber' | 'rose' | 'cyan' | 'gold';
};

export const ACTIVITY_NOTIFICATION_CARDS: ActivityNotificationCard[] = [
  {
    kind: 'first_cabinet_login',
    emoji: '🎉',
    title: 'Первый вход в личный кабинет',
    description: 'Ученик впервые успешно авторизовался и зашёл в кабинет на сайте.',
    accent: 'mint',
  },
  {
    kind: 'cabinet_login',
    emoji: '🔐',
    title: 'Повторный вход в кабинет',
    description: 'Каждая новая успешная авторизация после первого входа (не обновление страницы).',
    accent: 'sky',
  },
  {
    kind: 'cta_course_signup',
    emoji: '🎯',
    title: 'Переход к записи на курс',
    description: 'Клик «Записаться на курс» на главной и успешный вход в кабинет (Hero или блок инициации).',
    accent: 'violet',
  },
  {
    kind: 'course_map_first_view',
    emoji: '📚',
    title: 'Интерес к курсу',
    description: 'Первое открытие карты конкретного курса в кабинете (отдельно для каждого курса).',
    accent: 'cyan',
  },
  {
    kind: 'trial_lesson_first_view',
    emoji: '▶️',
    title: 'Пробное занятие',
    description: 'Первый просмотр пробного урока: страница занятия или начало воспроизведения видео.',
    accent: 'amber',
  },
  {
    kind: 'checkout_started',
    emoji: '🛒',
    title: 'Начало оформления',
    description: 'Подтверждение сценария и переход к оплате курса (ссылка bePaid создана).',
    accent: 'rose',
  },
  {
    kind: 'course_purchase_paid',
    emoji: '🎓',
    title: 'Покупка курса',
    description: 'Успешная оплата курса после подтверждения bePaid (без дублей при повторном webhook).',
    accent: 'gold',
  },
];

const catalogKinds = new Set(ACTIVITY_NOTIFICATION_CARDS.map((c) => c.kind));
for (const kind of ADMIN_ACTIVITY_NOTIFICATION_KINDS) {
  if (!catalogKinds.has(kind)) {
    throw new Error(`[activity-notification-catalog] missing UI card for kind: ${kind}`);
  }
}
if (catalogKinds.size !== ADMIN_ACTIVITY_NOTIFICATION_KINDS.length) {
  throw new Error('[activity-notification-catalog] card kinds out of sync with ADMIN_ACTIVITY_NOTIFICATION_KINDS');
}
