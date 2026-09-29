import type { Teacher } from '@/data/types';
import { buildImageUrl } from './sanityImage';

export type TeacherWithPhoto = Teacher & { photoUrl?: string | null };

export function withTeacherPhotoUrls(
  teachers: Teacher[],
  opts?: { width?: number; height?: number },
): TeacherWithPhoto[] {
  return teachers.map((teacher) => ({
    ...teacher,
    photoUrl: buildImageUrl(teacher.photo, opts),
  }));
}
