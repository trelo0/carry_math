import type { CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import type { CuratorStudentView } from '@/lib/curator/students';
import type { CuratorLowLivesEntry } from './curator-activity-data';

export type CuratorAttentionKind =
  | 'lives'
  | 'frozen'
  | 'full_block'
  | 'overdue'
  | 'activity'
  | 'access'
  | 'payment'
  | 'stale_review'
  | 'stuck'
  | 'revision_idle';

export type CuratorAttentionItem = {
  id: string;
  label: string;
  studentId: string;
  kind: CuratorAttentionKind;
};

export function buildCuratorAttentionItems(input: {
  lowLives: CuratorLowLivesEntry[];
  frozenStudents: CuratorStudentView[];
  fullyBlockedStudents: CuratorStudentView[];
  overdueStudents: Array<{ student: CuratorStudentView; count: number }>;
  lowActivityStudents: CuratorStudentRecord[];
  accessBlockedStudents: CuratorStudentRecord[];
  paymentWarnings: Array<{ student: CuratorStudentRecord; expiresAt: string }>;
  staleReviewStudents: Array<{ student: CuratorStudentView; days: number }>;
  stuckStudents: Array<{ student: CuratorStudentView; lessonLabel: string }>;
  revisionIdleStudents: CuratorStudentView[];
}): CuratorAttentionItem[] {
  const out: CuratorAttentionItem[] = [];

  for (const s of input.fullyBlockedStudents) {
    out.push({
      id: `full-${s.id}`,
      kind: 'full_block',
      studentId: s.id,
      label: `🔒 Полная блокировка: ${s.name}`,
    });
  }
  for (const s of input.frozenStudents) {
    out.push({
      id: `froz-${s.id}`,
      kind: 'frozen',
      studentId: s.id,
      label: `⏸️ Заморозка (0 жизней): ${s.name}`,
    });
  }
  for (const e of input.lowLives) {
    if (e.livesCurrent <= 0) continue; // уже в frozen
    out.push({
      id: `lives-${e.student.id}`,
      kind: 'lives',
      studentId: e.student.id,
      label: `❤️ Мало жизней: ${e.student.name} (${e.livesCurrent}${e.livesMax != null ? `/${e.livesMax}` : ''})`,
    });
  }
  for (const row of input.overdueStudents) {
    out.push({
      id: `od-${row.student.id}`,
      kind: 'overdue',
      studentId: row.student.id,
      label: `⏱ Просрочка ДЗ (${row.count}): ${row.student.name}`,
    });
  }
  for (const row of input.staleReviewStudents) {
    out.push({
      id: `stale-${row.student.id}`,
      kind: 'stale_review',
      studentId: row.student.id,
      label: `🟡 ДЗ на проверке >${row.days}д: ${row.student.name}`,
    });
  }
  for (const s of input.revisionIdleStudents) {
    out.push({
      id: `rev-${s.id}`,
      kind: 'revision_idle',
      studentId: s.id,
      label: `🔄 Не пересдал после reject: ${s.name}`,
    });
  }
  for (const row of input.stuckStudents) {
    out.push({
      id: `stuck-${row.student.id}`,
      kind: 'stuck',
      studentId: row.student.id,
      label: `📌 Застрял: ${row.student.name} · ${row.lessonLabel}`,
    });
  }
  for (const s of input.accessBlockedStudents) {
    if (input.frozenStudents.some((f) => f.id === s.id)) continue;
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
      label: `📉 Давно не заходил: ${s.name}`,
    });
  }
  return out;
}
