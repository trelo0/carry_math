export type CabinetLessonFileKind = 'material' | 'homework';

export function cabinetLessonFileUrl(
  lessonId: string,
  fileId: number,
  kind: CabinetLessonFileKind,
): string {
  return `/api/cabinet/lessons/${lessonId}/files/${fileId}?kind=${kind}`;
}

export function isExternalFileUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}
