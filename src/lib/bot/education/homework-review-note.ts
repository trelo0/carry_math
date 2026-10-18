const FILE_PREFIX = /^\[\[file:(photo|document|voice):([^\]]+)\]\]/;

export function packHomeworkReviewNote(
  text?: string | null,
  file?: { kind: 'photo' | 'document' | 'voice'; ref: string } | null,
): string | undefined {
  const body = text?.trim() ?? '';
  if (file?.ref) {
    const ref = file.ref.startsWith('tg:') ? file.ref : `tg:${file.ref}`;
    return `[[file:${file.kind}:${ref}]]${body}`;
  }
  return body || undefined;
}

export function unpackHomeworkReviewNote(stored: string | null | undefined): {
  text: string;
  fileKind: 'photo' | 'document' | 'voice' | null;
  fileRef: string | null;
} {
  const raw = stored ?? '';
  const match = raw.match(FILE_PREFIX);
  if (!match) return { text: raw, fileKind: null, fileRef: null };
  return {
    text: raw.slice(match[0].length),
    fileKind: match[1] as 'photo' | 'document' | 'voice',
    fileRef: match[2] ?? null,
  };
}
