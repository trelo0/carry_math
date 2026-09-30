import type { ReplyKeyboard } from '@/lib/bot/admin/core';
import type { StaffCapabilities } from './capabilities';

/** Reply-меню куратора (без расписания преподавателя). */
export const CURATOR_BOT_MENU_LABELS = {
  students: '👥 МОИ УЧЕНИКИ',
  homework: '📝 ДОМАШНИЕ ЗАДАНИЯ',
  messages: '💬 СООБЩЕНИЯ',
  course: '🎓 КУРС И ПРОГРЕСС',
  cabinet: '🌐 ПАНЕЛЬ УПРАВЛЕНИЯ',
} as const;

export const TEACHER_BOT_MENU_LABELS = {
  schedule: '📅 РАСПИСАНИЕ',
  students: '👥 МОИ УЧЕНИКИ',
  homework: '📝 ДОМАШНИЕ ЗАДАНИЯ',
  messages: '💬 СООБЩЕНИЯ',
  cabinet: '🌐 ПАНЕЛЬ УПРАВЛЕНИЯ',
} as const;

export type StaffBotMode = 'combined' | 'teacher_only' | 'curator_only' | null;

export const COMBINED_STAFF_MENU_LABELS = {
  schedule: '📅 РАСПИСАНИЕ',
  students: '👥 МОИ УЧЕНИКИ',
  homework: '📝 ДОМАШНИЕ ЗАДАНИЯ',
  messages: '💬 СООБЩЕНИЯ',
  course: '🎓 КУРС И ПРОГРЕСС',
  cabinet: '🌐 ПАНЕЛЬ УПРАВЛЕНИЯ',
} as const;

export const COMBINED_STAFF_MENU_LABEL_SET = new Set<string>(
  Object.values(COMBINED_STAFF_MENU_LABELS),
);

export function resolveStaffBotMode(caps: StaffCapabilities): StaffBotMode {
  if (caps.canTeacherBot && caps.canCuratorBot) return 'combined';
  if (caps.canTeacherBot) return 'teacher_only';
  if (caps.canCuratorBot) return 'curator_only';
  return null;
}

export function staffReplyKeyboard(caps: StaffCapabilities): ReplyKeyboard {
  const mode = resolveStaffBotMode(caps);
  if (mode === 'combined') {
    return {
      keyboard: [
        [
          { text: COMBINED_STAFF_MENU_LABELS.schedule },
          { text: COMBINED_STAFF_MENU_LABELS.students },
        ],
        [
          { text: COMBINED_STAFF_MENU_LABELS.homework },
          { text: COMBINED_STAFF_MENU_LABELS.messages },
        ],
        [{ text: COMBINED_STAFF_MENU_LABELS.course }],
        [{ text: COMBINED_STAFF_MENU_LABELS.cabinet }],
      ],
      resize_keyboard: true,
    };
  }
  if (mode === 'teacher_only') {
    return {
      keyboard: [
        [
          { text: TEACHER_BOT_MENU_LABELS.schedule },
          { text: TEACHER_BOT_MENU_LABELS.students },
        ],
        [
          { text: TEACHER_BOT_MENU_LABELS.messages },
          { text: TEACHER_BOT_MENU_LABELS.homework },
        ],
        [{ text: TEACHER_BOT_MENU_LABELS.cabinet }],
      ],
      resize_keyboard: true,
    };
  }
  if (mode === 'curator_only') {
    return {
      keyboard: [
        [
          { text: CURATOR_BOT_MENU_LABELS.students },
          { text: CURATOR_BOT_MENU_LABELS.homework },
        ],
        [
          { text: CURATOR_BOT_MENU_LABELS.messages },
          { text: CURATOR_BOT_MENU_LABELS.course },
        ],
        [{ text: CURATOR_BOT_MENU_LABELS.cabinet }],
      ],
      resize_keyboard: true,
    };
  }
  return { keyboard: [], resize_keyboard: true };
}

export function isStaffMenuLabel(text: string, caps: StaffCapabilities): boolean {
  const mode = resolveStaffBotMode(caps);
  if (mode === 'combined') return COMBINED_STAFF_MENU_LABEL_SET.has(text);
  if (mode === 'teacher_only') {
    return new Set<string>(Object.values(TEACHER_BOT_MENU_LABELS)).has(text);
  }
  if (mode === 'curator_only') {
    return new Set<string>(Object.values(CURATOR_BOT_MENU_LABELS)).has(text);
  }
  return false;
}
