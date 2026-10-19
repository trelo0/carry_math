const FILE_TAG = /\[\[file:(photo|document|voice):([^\]]+)\]\]/g;

export type HomeworkReviewFile = {
  kind: 'photo' | 'document' | 'voice';
  ref: string;
};

export function packHomeworkReviewNote(
  text?: string | null,
  files?: HomeworkReviewFile[] | null,
  legacyFile?: { kind: 'photo' | 'document' | 'voice'; ref: string } | null,
): string | undefined {
  const list: HomeworkReviewFile[] = [...(files ?? [])];
  if (legacyFile?.ref) {
    const ref = legacyFile.ref.startsWith('tg:') ? legacyFile.ref : `tg:${legacyFile.ref}`;
    if (!list.some((f) => f.ref === ref && f.kind === legacyFile.kind)) {
      list.push({ kind: legacyFile.kind, ref });
    }
  }
  const prefix = list
    .map((f) => {
      const ref = f.ref.startsWith('tg:') ? f.ref : `tg:${f.ref}`;
      return `[[file:${f.kind}:${ref}]]`;
    })
    .join('');
  const body = text?.trim() ?? '';
  const packed = `${prefix}${body}`;
  return packed || undefined;
}

export function unpackHomeworkReviewParts(stored: string | null | undefined): {
  files: HomeworkReviewFile[];
  text: string;
} {
  const raw = stored ?? '';
  const files: HomeworkReviewFile[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_TAG.source, 'g');
  while ((m = re.exec(raw)) !== null) {
    files.push({ kind: m[1] as HomeworkReviewFile['kind'], ref: m[2] ?? '' });
  }
  const text = raw.replace(re, '').trim();
  return { files, text };
}

/** @deprecated используйте unpackHomeworkReviewParts */
export function unpackHomeworkReviewNote(stored: string | null | undefined): {
  text: string;
  fileKind: 'photo' | 'document' | 'voice' | null;
  fileRef: string | null;
} {
  const { files, text } = unpackHomeworkReviewParts(stored);
  const first = files[0];
  return {
    text,
    fileKind: first?.kind ?? null,
    fileRef: first?.ref ?? null,
  };
}

export function isPlaceholderReviewText(text: string | null | undefined): boolean {
  const t = text?.trim() ?? '';
  return (
    !t ||
    t === 'Голосовой комментарий' ||
    t === 'Комментарий на фото' ||
    t === 'Комментарий в файле'
  );
}
