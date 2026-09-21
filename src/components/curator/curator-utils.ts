import type { CuratorLessonSessionStatus } from '@/lib/curator/cabinet-data';
import type { CuratorHwStatus } from '@/lib/bot/curator/curator-types';
import { CURATOR_HW_STATUS_LABELS } from '@/lib/bot/curator/curator-types';

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Дата не указана';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sessionLabel(status: CuratorLessonSessionStatus): string {
  if (status === 'scheduled') return 'Запланировано';
  if (status === 'waiting') return 'Ожидание эфира';
  if (status === 'live') return 'В эфире';
  if (status === 'completed') return 'Завершено';
  if (status === 'cancelled') return 'Отменено';
  return 'Черновик';
}

export function sessionPillClass(status: CuratorLessonSessionStatus): string {
  if (status === 'live') return 'is-live';
  if (status === 'waiting') return 'is-waiting';
  if (status === 'completed') return 'is-done';
  if (status === 'scheduled') return 'is-planned';
  return '';
}

export function hwStatusLabel(status: CuratorHwStatus): string {
  return CURATOR_HW_STATUS_LABELS[status];
}

export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
