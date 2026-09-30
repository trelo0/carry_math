import type { CuratorStudentRecord } from '@/lib/bot/curator/curatorData';

export type CuratorStudentCardEnrichment = {
  progressLine: string;
  activeHomeworkLine: string | null;
};

/** Достоверные строки только из уже загруженных homeworks (mentor_assignments). */
export function enrichCuratorStudentCard(student: CuratorStudentRecord): CuratorStudentCardEnrichment {
  const relevant = student.homeworks.filter((h) => h.status !== 'upcoming');
  const total = relevant.length;
  const approved = relevant.filter((h) => h.status === 'approved').length;
  const submitted = relevant.filter((h) => h.status === 'submitted').length;
  const revision = relevant.filter((h) => h.status === 'revision').length;
  const waiting = relevant.filter((h) => h.status === 'waiting').length;

  const progressLine =
    total > 0
      ? `📊 Прогресс по ДЗ курса: ${approved} принято из ${total} доступных`
      : '📊 Прогресс по ДЗ: пока нет доступных заданий';

  let activeHomeworkLine: string | null = null;
  if (submitted > 0) {
    activeHomeworkLine = `🟡 На проверке: ${submitted} работ`;
  } else if (revision > 0) {
    activeHomeworkLine = `🔄 На доработке: ${revision}`;
  } else if (waiting > 0) {
    activeHomeworkLine = `⏳ Не сдано: ${waiting} заданий`;
  }

  const lastApproved = [...relevant]
    .filter((h) => h.status === 'approved')
    .sort((a, b) => b.number - a.number)[0];
  if (lastApproved) {
    activeHomeworkLine = (activeHomeworkLine ? `${activeHomeworkLine}\n` : '') +
      `✅ Последнее принятое: ДЗ №${lastApproved.number}`;
  }

  return { progressLine, activeHomeworkLine };
}
