import { CURATOR_STUDENT_SEED, type CuratorHwItem, type CuratorHwStatus } from './mock-data';

// ---------------------------------------------------------------------------
// MOCK-состояние кабинета ментора: живёт только в памяти процесса.
// После перезапуска приложения данные сбрасываются к начальному seed —
// это нормально для этапа проверки UX (§19). В Supabase ничего не пишется.
// ---------------------------------------------------------------------------

export type CuratorStudentState = {
  id: string;
  name: string;
  homeworks: CuratorHwItem[];
};

let students: CuratorStudentState[] = CURATOR_STUDENT_SEED.map((seed) => ({
  id: seed.id,
  name: seed.name,
  homeworks: seed.homeworks.map((hw) => ({ ...hw })),
}));

// Прочитанные уведомления о новых отправках ДЗ (ключ — studentId:number).
const readNotifications = new Set<string>();

export function resetCuratorMockState(): void {
  students = CURATOR_STUDENT_SEED.map((seed) => ({
    id: seed.id,
    name: seed.name,
    homeworks: seed.homeworks.map((hw) => ({ ...hw })),
  }));
  readNotifications.clear();
}

export function getCuratorStudents(): CuratorStudentState[] {
  return students;
}

export function getCuratorStudent(studentId: string): CuratorStudentState | undefined {
  return students.find((student) => student.id === studentId);
}

export function getCuratorHomework(studentId: string, hwNumber: number): CuratorHwItem | undefined {
  return getCuratorStudent(studentId)?.homeworks.find((hw) => hw.number === hwNumber);
}

export function setCuratorHomeworkStatus(
  studentId: string,
  hwNumber: number,
  status: CuratorHwStatus,
  comment?: string,
): boolean {
  const homework = getCuratorHomework(studentId, hwNumber);
  if (!homework) return false;
  homework.status = status;
  if (comment !== undefined) (homework as CuratorHwItem & { comment?: string }).comment = comment;
  return true;
}

export function getCuratorHomeworkComment(studentId: string, hwNumber: number): string | undefined {
  const homework = getCuratorHomework(studentId, hwNumber);
  return homework ? (homework as CuratorHwItem & { comment?: string }).comment : undefined;
}

// ---------------------------------------------------------------------------
// Расчётные показатели ученика: статус и долги НЕ хранятся, а выводятся
// из статусов его ДЗ (§3, §5).
// ---------------------------------------------------------------------------

export type CuratorStudentLevel = 'ok' | 'review' | 'debt';

export type CuratorStudentSummary = {
  level: CuratorStudentLevel;
  emoji: string;
  // Задолженность = несданные ДЗ (waiting).
  debtCount: number;
  debtNumbers: number[];
  reviewCount: number;
  revisionCount: number;
};

export function getCuratorStudentSummary(student: CuratorStudentState): CuratorStudentSummary {
  const debtNumbers = student.homeworks.filter((hw) => hw.status === 'waiting').map((hw) => hw.number);
  const reviewCount = student.homeworks.filter((hw) => hw.status === 'submitted').length;
  const revisionCount = student.homeworks.filter((hw) => hw.status === 'revision').length;
  const level: CuratorStudentLevel = debtNumbers.length > 0 ? 'debt' : reviewCount > 0 ? 'review' : 'ok';
  const emoji = level === 'debt' ? '🔴' : level === 'review' ? '🟡' : '🟢';
  return { level, emoji, debtCount: debtNumbers.length, debtNumbers, reviewCount, revisionCount };
}

// Подпись ученика в списке: «🔴 Иван Петров — 2 долга» / «🟡 … — 1 ДЗ на проверке».
export function getCuratorStudentListLabel(student: CuratorStudentState): string {
  const summary = getCuratorStudentSummary(student);
  if (summary.level === 'debt') return `${summary.emoji} ${student.name} — ${debtLabel(summary.debtCount)}`;
  if (summary.level === 'review') return `${summary.emoji} ${student.name} — ${summary.reviewCount} ДЗ на проверке`;
  return `${summary.emoji} ${student.name}`;
}

function debtLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} долг`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} долга`;
  return `${count} долгов`;
}

// ---------------------------------------------------------------------------
// Уведомления: новая отправка = ДЗ в статусе submitted. Непрочитанность —
// флаг в памяти, без БД (§15).
// ---------------------------------------------------------------------------

export type CuratorSubmissionNotification = {
  id: string;
  studentId: string;
  studentName: string;
  hwNumber: number;
};

export function getCuratorNewSubmissions(): CuratorSubmissionNotification[] {
  return students.flatMap((student) =>
    student.homeworks
      .filter((hw) => hw.status === 'submitted')
      .map((hw) => ({
        id: `${student.id}:${hw.number}`,
        studentId: student.id,
        studentName: student.name,
        hwNumber: hw.number,
      })),
  );
}

export function isCuratorNotificationRead(notificationId: string): boolean {
  return readNotifications.has(notificationId);
}

export function markCuratorNotificationRead(notificationId: string): void {
  readNotifications.add(notificationId);
}

export function getCuratorUnreadCount(): number {
  return getCuratorNewSubmissions().filter((n) => !readNotifications.has(n.id)).length;
}

// Количество непрочитанных отправок конкретного ученика (mock).
export function getCuratorStudentUnreadCount(studentId: string): number {
  return getCuratorNewSubmissions().filter((n) => n.studentId === studentId && !readNotifications.has(n.id)).length;
}

export function getCuratorNotification(notificationId: string): CuratorSubmissionNotification | undefined {
  return getCuratorNewSubmissions().find((n) => n.id === notificationId);
}

// ---------------------------------------------------------------------------
// Жизни на Арене (§7): UI-заглушка. Позже сюда подключится реальное
// значение — интерфейс уже ожидает строку или null («—»).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- параметр понадобится при подключении реального значения.
export function getCuratorStudentLives(_studentId: string): string | null {
  return null;
}
