import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { loadAdminCourseBundle, type AdminCourseBundle } from '@/lib/admin/courses-data';

/** Кэш на RSC-запрос: layout курса и страница делят один bundle. */
export const requireAdminCourseBundle = cache(async (courseIdRaw: string): Promise<AdminCourseBundle> => {
  const courseId = Number(courseIdRaw);
  if (!Number.isFinite(courseId)) notFound();

  const ctx = await getAdminCabinetContext();
  if (!ctx) notFound();

  const bundle = await loadAdminCourseBundle(ctx.admin, courseId);
  if (!bundle) notFound();
  return bundle;
});
