import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleLesson } from './lessons';
import { resolveTelegramIdByPhone } from './purchase-fulfillment';

export type ScheduleMaterialInput = {
  name: string;
  url: string;
  size?: string;
};

export type ScheduleHomeworkInput = {
  name: string;
  url: string;
  size?: string;
};

export type ScheduleStudentLessonInput = {
  kind: 'individual' | 'group';
  startsAt: string;
  topic: string;
  packageId?: number;
  meetUrl?: string;
  teacherTelegramId?: number;
  groupId?: number;
  durationMinutes?: number;
  materials?: ScheduleMaterialInput[];
  homework?: ScheduleHomeworkInput;
};

export class LessonScheduleError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_LINKED'
      | 'INVALID_KIND'
      | 'NO_PACKAGE'
      | 'PACKAGE_MISMATCH'
      | 'INVALID_MATERIAL'
      | 'INVALID_HOMEWORK',
  ) {
    super(message);
    this.name = 'LessonScheduleError';
  }
}

type LessonPackageRow = {
  id: number;
  product: string;
  remaining_lessons: number;
  status: string;
};

async function resolveActivePackage(
  admin: SupabaseClient,
  telegramId: number,
  kind: 'individual' | 'group',
  packageId?: number,
): Promise<LessonPackageRow> {
  if (packageId != null) {
    const { data, error } = await admin
      .from('lesson_packages')
      .select('id, product, remaining_lessons, status')
      .eq('id', packageId)
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new LessonScheduleError(`Пакет ${packageId} не найден у ученика.`, 'NO_PACKAGE');
    }
    if (data.product !== kind) {
      throw new LessonScheduleError(
        `Пакет «${data.product}» не подходит для занятия «${kind}».`,
        'PACKAGE_MISMATCH',
      );
    }
    if (data.status !== 'active' || (data.remaining_lessons as number) <= 0) {
      throw new LessonScheduleError('В пакете не осталось занятий для назначения.', 'NO_PACKAGE');
    }
    return data as LessonPackageRow;
  }

  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, product, remaining_lessons, status')
    .eq('telegram_id', telegramId)
    .eq('product', kind)
    .eq('status', 'active')
    .gt('remaining_lessons', 0)
    .order('purchased_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new LessonScheduleError(`Нет активного пакета «${kind}».`, 'NO_PACKAGE');
  }
  return data as LessonPackageRow;
}

function assertHttpUrl(
  url: string,
  label: string,
  code: 'INVALID_MATERIAL' | 'INVALID_HOMEWORK' = 'INVALID_MATERIAL',
): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new LessonScheduleError(`${label}: нужен http(s) URL.`, code);
  }
}

/** Назначение ind/group занятия + материалы/ДЗ. До бота — через CLI/API. */
export async function scheduleStudentLesson(
  admin: SupabaseClient,
  telegramId: number,
  input: ScheduleStudentLessonInput,
): Promise<{ lessonId: number; packageId: number }> {
  if (input.kind !== 'individual' && input.kind !== 'group') {
    throw new LessonScheduleError('kind должен быть individual или group.', 'INVALID_KIND');
  }

  for (const material of input.materials ?? []) {
    assertHttpUrl(material.url, `Материал «${material.name}»`);
  }
  if (input.homework) {
    assertHttpUrl(input.homework.url, `Домашка «${input.homework.name}»`, 'INVALID_HOMEWORK');
  }

  const pkg = await resolveActivePackage(admin, telegramId, input.kind, input.packageId);

  const lessonId = await scheduleLesson(admin, {
    telegramId,
    kind: input.kind,
    startsAt: input.startsAt,
    topic: input.topic,
    packageId: pkg.id,
    meetUrl: input.meetUrl,
    teacherTelegramId: input.teacherTelegramId,
    groupId: input.groupId,
    durationMinutes: input.durationMinutes,
  });

  const now = new Date().toISOString();
  const { error: paidError } = await admin
    .from('scheduled_lessons')
    .update({ is_paid: true, updated_at: now })
    .eq('id', lessonId);
  if (paidError) throw paidError;

  if (input.materials?.length) {
    const { error: materialsError } = await admin.from('lesson_materials').insert(
      input.materials.map((material, index) => ({
        lesson_id: lessonId,
        file_name: material.name,
        file_size: material.size ?? null,
        storage_path: material.url,
        sort_order: index,
      })),
    );
    if (materialsError) throw materialsError;
  }

  if (input.homework) {
    const { error: homeworkError } = await admin.from('homework_assignments').insert({
      lesson_id: lessonId,
      file_name: input.homework.name,
      file_size: input.homework.size ?? null,
      storage_path: input.homework.url,
    });
    if (homeworkError) throw homeworkError;
  }

  return { lessonId, packageId: pkg.id };
}

export async function scheduleStudentLessonByPhone(
  admin: SupabaseClient,
  phone: string,
  input: ScheduleStudentLessonInput,
): Promise<{ telegramId: number; lessonId: number; packageId: number }> {
  const telegramId = await resolveTelegramIdByPhone(admin, phone);
  if (!telegramId) {
    throw new LessonScheduleError(`Telegram не привязан к ${phone}`, 'NOT_LINKED');
  }
  const result = await scheduleStudentLesson(admin, telegramId, input);
  return { telegramId, ...result };
}
