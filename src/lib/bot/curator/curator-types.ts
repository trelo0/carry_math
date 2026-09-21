export type CuratorHwStatus =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'revision'
  | 'waiting'
  | 'upcoming';

export const CURATOR_HW_STATUS_LABELS: Record<CuratorHwStatus, string> = {
  submitted: '🟡 Ждёт проверки',
  approved: '✅ Одобрено',
  rejected: '❌ Отклонено',
  revision: '🔄 На доработке',
  waiting: '⚪ Не сдано',
  upcoming: '🔒 После эфира',
};

export const CURATOR_HW_STATUS_SHORT: Record<CuratorHwStatus, string> = {
  submitted: 'ждёт проверки',
  approved: 'одобрено',
  rejected: 'отклонено',
  revision: 'на доработке',
  waiting: 'не сдано',
  upcoming: 'после эфира',
};

export type CuratorHwItem = {
  number: number;
  status: CuratorHwStatus;
};

export type CuratorLibraryTask = {
  id: string;
  title: string;
  condition: string;
  fileUrl: string | null;
};

export type CuratorLibraryWebinar = {
  id: string;
  title: string;
  tasks: CuratorLibraryTask[];
};
