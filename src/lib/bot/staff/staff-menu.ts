import type { ReplyKeyboard } from '@/lib/bot/admin/core';
import { memberHasRole } from '@/lib/bot/roles';
import type { StaffCapabilities } from './capabilities';

/** Reply-меню куратора курса. */
export const CURATOR_BOT_MENU_LABELS = {
  schedule: '📅 Расписание курса',
  lessons: '📚 Занятия курса',
  students: '👥 Ученики курса',
  cabinet: '🌐 Панель управления',
} as const;

export const CURATOR_BOT_MENU_LABEL_SET = new Set<string>(Object.values(CURATOR_BOT_MENU_LABELS));

export const TEACHER_BOT_MENU_LABELS = {
  schedule: '📅 Расписание',
  students: '👥 Мои ученики',
  homework: '📝 Домашние задания',
  messages: '💬 Сообщения',
  cabinet: '🌐 Панель управления',
} as const;

export type StaffBotMode =
  | 'combined'
  | 'teacher_only'
  | 'curator_only'
  | 'check_only'
  | 'course_staff_only'
  | null;

/** Reply-меню проверяющего ДЗ (только Telegram). */
export const CHECK_BOT_MENU_LABELS = {
  homework: '📝 Домашние задания',
  students: '👥 Ученики',
  messages: '💬 Сообщения',
  library: '📚 База домашних заданий',
} as const;

export const CHECK_BOT_MENU_LABEL_SET = new Set<string>(Object.values(CHECK_BOT_MENU_LABELS));

export const STAFF_COURSE_MANAGEMENT_LABEL = '🎓 Управление курсами';
export const STAFF_EXIT_ALL_COURSES_LABEL = '⬅️ Все курсы';

export const COMBINED_STAFF_MENU_LABELS = {
  schedule: '📅 Расписание',
  students: '👥 Мои ученики',
  homework: '📝 Домашние задания',
  messages: '💬 Сообщения',
  myCourse: STAFF_COURSE_MANAGEMENT_LABEL,
  cabinet: '🌐 Панель управления',
} as const;

export const COMBINED_STAFF_MENU_LABEL_SET = new Set<string>(
  Object.values(COMBINED_STAFF_MENU_LABELS),
);

export function resolveStaffBotMode(caps: StaffCapabilities): StaffBotMode {
  // Эффективная роль / маска важнее сырых flags (admin preview иначе ломал teacher UI).
  if (
    caps.effectiveRole === 'teacher' &&
    caps.canTeacherBot &&
    !caps.canCuratorBot &&
    !caps.canCourseStaffBot
  ) {
    return 'teacher_only';
  }
  if (caps.effectiveRole === 'curator' && caps.canCuratorBot && !caps.canTeacherBot) {
    return 'curator_only';
  }

  const hasTeacher = memberHasRole(caps.roles, 'teacher') || caps.effectiveRole === 'teacher';
  const hasCurator = memberHasRole(caps.roles, 'curator') || caps.effectiveRole === 'curator';
  if (caps.canTeacherBot && caps.canCourseStaffBot) return 'combined';
  if (caps.canTeacherBot && caps.canCuratorBot && hasTeacher && hasCurator) return 'combined';
  if (caps.canTeacherBot && (hasTeacher || caps.effectiveRole === 'teacher')) return 'teacher_only';
  if (caps.canCuratorBot && (hasCurator || caps.effectiveRole === 'curator')) return 'curator_only';
  if (caps.canTeacherBot && caps.canCuratorBot) return 'combined';
  if (caps.canTeacherBot) return 'teacher_only';
  if (caps.canCuratorBot) return 'curator_only';
  if (!caps.canTeacherBot && !caps.canCuratorBot && caps.canCourseStaffBot) return 'check_only';
  if (caps.canCourseStaffBot) return 'course_staff_only';
  return null;
}

export function staffCourseWorkspaceReplyKeyboard(role: 'curator' | 'check'): ReplyKeyboard {
  if (role === 'curator') {
    return {
      keyboard: [
        [{ text: CURATOR_BOT_MENU_LABELS.schedule }],
        [{ text: CURATOR_BOT_MENU_LABELS.lessons }],
        [{ text: CURATOR_BOT_MENU_LABELS.students }],
        [{ text: STAFF_EXIT_ALL_COURSES_LABEL }],
        [{ text: CURATOR_BOT_MENU_LABELS.cabinet }],
      ],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [
      [
        { text: CHECK_BOT_MENU_LABELS.homework },
        { text: CHECK_BOT_MENU_LABELS.students },
      ],
      [
        { text: CHECK_BOT_MENU_LABELS.messages },
        { text: CHECK_BOT_MENU_LABELS.library },
      ],
      [{ text: STAFF_EXIT_ALL_COURSES_LABEL }],
    ],
    resize_keyboard: true,
  };
}

export function staffGlobalReplyKeyboard(caps: StaffCapabilities): ReplyKeyboard {
  const mode = resolveStaffBotMode(caps);
  if (mode === 'combined') {
    return {
      keyboard: [
        [
          { text: COMBINED_STAFF_MENU_LABELS.schedule },
          { text: COMBINED_STAFF_MENU_LABELS.students },
        ],
        [
          { text: COMBINED_STAFF_MENU_LABELS.messages },
          { text: COMBINED_STAFF_MENU_LABELS.homework },
        ],
        [{ text: COMBINED_STAFF_MENU_LABELS.myCourse }],
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
      keyboard: [[{ text: STAFF_COURSE_MANAGEMENT_LABEL }], [{ text: CURATOR_BOT_MENU_LABELS.cabinet }]],
      resize_keyboard: true,
    };
  }
  if (mode === 'check_only') {
    return {
      keyboard: [[{ text: STAFF_COURSE_MANAGEMENT_LABEL }]],
      resize_keyboard: true,
    };
  }
  if (mode === 'course_staff_only') {
    return {
      keyboard: [[{ text: STAFF_COURSE_MANAGEMENT_LABEL }], [{ text: COMBINED_STAFF_MENU_LABELS.cabinet }]],
      resize_keyboard: true,
    };
  }
  return { keyboard: [], resize_keyboard: true };
}

/** @deprecated используйте staffGlobalReplyKeyboard */
export function staffReplyKeyboard(caps: StaffCapabilities): ReplyKeyboard {
  return staffGlobalReplyKeyboard(caps);
}

const STAFF_GLOBAL_LABEL_ALIASES = new Set<string>(['🎓 Курс']);

export function isStaffGlobalMenuLabel(text: string, caps: StaffCapabilities): boolean {
  const mode = resolveStaffBotMode(caps);
  if (mode === 'combined') {
    return COMBINED_STAFF_MENU_LABEL_SET.has(text) || STAFF_GLOBAL_LABEL_ALIASES.has(text);
  }
  if (mode === 'teacher_only') {
    return new Set<string>(Object.values(TEACHER_BOT_MENU_LABELS)).has(text);
  }
  if (mode === 'curator_only') {
    return text === STAFF_COURSE_MANAGEMENT_LABEL || text === CURATOR_BOT_MENU_LABELS.cabinet;
  }
  if (mode === 'check_only') {
    return text === STAFF_COURSE_MANAGEMENT_LABEL;
  }
  if (mode === 'course_staff_only') {
    return (
      text === STAFF_COURSE_MANAGEMENT_LABEL ||
      text === COMBINED_STAFF_MENU_LABELS.myCourse ||
      text === COMBINED_STAFF_MENU_LABELS.cabinet ||
      STAFF_GLOBAL_LABEL_ALIASES.has(text)
    );
  }
  return false;
}

export function isStaffWorkspaceMenuLabel(text: string, role: 'curator' | 'check'): boolean {
  if (text === STAFF_EXIT_ALL_COURSES_LABEL) return true;
  if (role === 'curator') return CURATOR_BOT_MENU_LABEL_SET.has(text);
  return CHECK_BOT_MENU_LABEL_SET.has(text);
}

export function isStaffMenuLabel(text: string, caps: StaffCapabilities): boolean {
  if (isStaffGlobalMenuLabel(text, caps)) return true;
  if (caps.canCuratorBot) {
    if (CURATOR_BOT_MENU_LABEL_SET.has(text) || text === STAFF_EXIT_ALL_COURSES_LABEL) return true;
  }
  if (caps.canCourseStaffBot) {
    if (CHECK_BOT_MENU_LABEL_SET.has(text) || text === STAFF_EXIT_ALL_COURSES_LABEL) return true;
  }
  return false;
}
