/** Роли, которые админ может назначать из панели (клиент-безопасный модуль). */
export const ASSIGNABLE_ROLES = ['guest', 'student', 'staff', 'curator', 'check', 'teacher', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_TITLES: Record<AssignableRole, string> = {
  guest: 'Гость',
  student: 'Ученик',
  staff: 'Сотрудник (staff)',
  curator: 'Куратор',
  check: 'Проверяющий ДЗ',
  teacher: 'Преподаватель',
  admin: 'Админ',
};

export const ROLE_HINTS: Record<AssignableRole, string> = {
  guest: 'Без доступа к обучению',
  student: 'Учится на курсах',
  staff: 'Рабочая роль сотрудника, нужна для назначения на курсы',
  curator: 'Ведёт учеников в Telegram',
  check: 'Проверяет домашние задания',
  teacher: 'Проводит занятия',
  admin: 'Полный доступ к админ-панели',
};

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
