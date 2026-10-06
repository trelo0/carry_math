import type { CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import type { CuratorLowLivesEntry } from './curator-activity-data';

export type CuratorAttentionItem = {
  id: string;
  label: string;
  studentId: string;
  kind: 'lives' | 'activity' | 'access' | 'payment';
};

export function buildCuratorAttentionItems(input: {
  lowLives: CuratorLowLivesEntry[];
  lowActivityStudents: CuratorStudentRecord[];
  accessBlockedStudents: CuratorStudentRecord[];
  paymentWarnings: Array<{ student: CuratorStudentRecord; expiresAt: string }>;
}): CuratorAttentionItem[] {
  const out: CuratorAttentionItem[] = [];
  for (const e of input.lowLives) {
    out.push({
      id: `lives-${e.student.id}`,
      kind: 'lives',
      studentId: e.student.id,
      label: `❤️ Мало жизней: ${e.student.name} (${e.livesCurrent}${e.livesMax != null ? `/${e.livesMax}` : ''})`,
    });
  }
  for (const s of input.accessBlockedStudents) {
    out.push({
      id: `access-${s.id}`,
      kind: 'access',
      studentId: s.id,
      label: `🔒 Доступ ограничен: ${s.name}`,
    });
  }
  for (const w of input.paymentWarnings) {
    out.push({
      id: `pay-${w.student.id}`,
      kind: 'payment',
      studentId: w.student.id,
      label: `💳 Скоро конец доступа: ${w.student.name}`,
    });
  }
  for (const s of input.lowActivityStudents) {
    out.push({
      id: `low-${s.id}`,
      kind: 'activity',
      studentId: s.id,
      label: `📉 Низкая активность: ${s.name}`,
    });
  }
  return out;
}
