// ---------------------------------------------------------------------------
// MOCK-данные кабинета ментора (role = curator; в UI — «Ментор»).
// Этап проверки UX: только тестовые данные, без реальных Telegram ID,
// без записи в Supabase и без доставки сообщений ученикам.
// ---------------------------------------------------------------------------

// Статусы домашних заданий (§3). «Должник» отдельным флагом не хранится —
// всё рассчитывается из статусов ДЗ (см. mock-state.ts).
export type CuratorHwStatus = 'submitted' | 'approved' | 'rejected' | 'revision' | 'waiting';

export const CURATOR_HW_STATUS_LABELS: Record<CuratorHwStatus, string> = {
  submitted: '🟡 Ждёт проверки',
  approved: '✅ Одобрено',
  rejected: '❌ Отклонено',
  revision: '🔄 На доработке',
  waiting: '⚪ Не сдано',
};

// Короткие подписи для списка ДЗ в профиле ученика.
export const CURATOR_HW_STATUS_SHORT: Record<CuratorHwStatus, string> = {
  submitted: 'ждёт проверки',
  approved: 'одобрено',
  rejected: 'отклонено',
  revision: 'на доработке',
  waiting: 'не сдано',
};

export interface CuratorHwItem {
  number: number;
  status: CuratorHwStatus;
}

export interface CuratorStudentSeed {
  id: string;
  name: string;
  homeworks: CuratorHwItem[];
}

// Начальное состояние учеников ментора. Статусы ДЗ — единственный источник:
// задолженность и статус ученика рассчитываются из них.
export const CURATOR_STUDENT_SEED: CuratorStudentSeed[] = [
  {
    id: 's1',
    name: 'Иван Петров',
    homeworks: [
      { number: 1, status: 'approved' },
      { number: 2, status: 'waiting' },
      { number: 3, status: 'revision' },
      { number: 4, status: 'submitted' },
      { number: 5, status: 'waiting' },
    ],
  },
  {
    id: 's2',
    name: 'Мария Сидорова',
    homeworks: [
      { number: 1, status: 'approved' },
      { number: 2, status: 'approved' },
      { number: 3, status: 'submitted' },
    ],
  },
  {
    id: 's3',
    name: 'Алексей Ковалёв',
    homeworks: [
      { number: 1, status: 'approved' },
      { number: 2, status: 'approved' },
      { number: 3, status: 'approved' },
      { number: 4, status: 'approved' },
      { number: 5, status: 'submitted' },
    ],
  },
  {
    id: 's4',
    name: 'Анна Смирнова',
    homeworks: [
      { number: 1, status: 'approved' },
      { number: 2, status: 'waiting' },
      { number: 3, status: 'approved' },
    ],
  },
  {
    id: 's5',
    name: 'Дмитрий Волков',
    homeworks: [
      { number: 1, status: 'approved' },
      { number: 2, status: 'approved' },
      { number: 3, status: 'approved' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Библиотека учебных материалов (§4): курс → вебинары → задания.
// ---------------------------------------------------------------------------

export interface CuratorLibraryTask {
  id: string;
  title: string;
  condition: string;
}

export interface CuratorLibraryWebinar {
  id: string;
  title: string;
  tasks: CuratorLibraryTask[];
}

export const CURATOR_LIBRARY: CuratorLibraryWebinar[] = [
  {
    id: 'w1',
    title: 'Вебинар 1',
    tasks: [
      { id: 'w1t1', title: 'Домашнее задание №1', condition: 'Тестовое условие домашнего задания №1: решите уравнения из конспекта вебинара 1.' },
      { id: 'w1t2', title: 'Домашнее задание №2', condition: 'Тестовое условие домашнего задания №2: разберите задачи на проценты.' },
      { id: 'w1t3', title: 'Домашнее задание №3', condition: 'Тестовое условие домашнего задания №3: постройте графики функций.' },
    ],
  },
  {
    id: 'w2',
    title: 'Вебинар 2',
    tasks: [
      { id: 'w2t1', title: 'Домашнее задание №1', condition: 'Тестовое условие домашнего задания №1: упростите выражения.' },
      { id: 'w2t2', title: 'Домашнее задание №2', condition: 'Тестовое условие домашнего задания №2: решите систему уравнений.' },
      { id: 'w2t3', title: 'Домашнее задание №3', condition: 'Тестовое условие домашнего задания №3: найдите область определения.' },
    ],
  },
  {
    id: 'w3',
    title: 'Вебинар 3',
    tasks: [
      { id: 'w3t1', title: 'Домашнее задание №1', condition: 'Тестовое условие домашнего задания №1: задачи на движение.' },
      { id: 'w3t2', title: 'Домашнее задание №2', condition: 'Тестовое условие домашнего задания №2: задачи на работу.' },
      { id: 'w3t3', title: 'Домашнее задание №3', condition: 'Тестовое условие домашнего задания №3: комбинаторика, базовый уровень.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Экран «Контроль перед занятием» (§16): мок-сводка без cron и расписания.
// ---------------------------------------------------------------------------

export const CURATOR_PRE_LESSON_SUMMARY = {
  notSubmitted: 7,
  awaitingReview: 4,
  revision: 3,
};
