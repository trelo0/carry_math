import { NextResponse } from 'next/server';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { getCuratorCabinetData } from '@/lib/curator/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

export async function GET() {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getCuratorCabinetData(auth.admin, auth.telegramId, auth.fullName);
    // Ленивая проверка дедлайнов учеников куратора (без отдельного cron).
    const studentIds = data.students?.map((s) => s.telegramId).filter(Boolean) ?? [];
    if (studentIds.length > 0) {
      const { runHomeworkDeadlineReminders } = await import(
        '@/lib/bot/education/homework-deadline-notify'
      );
      void runHomeworkDeadlineReminders(auth.admin, new Date(), {
        telegramIds: studentIds,
        limit: 120,
      }).catch((err) => console.error('[curator/data] hw-deadline sweep failed:', err));
    }
    return NextResponse.json(data);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load curator data');
  }
}
