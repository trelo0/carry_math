/** Лимит тела запроса на Vercel (~4.5 МБ); оставляем запас. */
export const CABINET_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export function cabinetUploadMaxLabelMb(): string {
  return `${Math.floor(CABINET_UPLOAD_MAX_BYTES / (1024 * 1024))} МБ`;
}

export function cabinetUploadTooLargeMessage(): string {
  return `Файл слишком большой. Максимум для загрузки через кабинет — ${cabinetUploadMaxLabelMb()}. Сожмите PDF или разбейте материал.`;
}

/** Ответ API: JSON с error или plain text (413, HTML прокси). */
export async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 413) return cabinetUploadTooLargeMessage();
    return fallback;
  }
  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return json.error ?? json.message ?? fallback;
  } catch {
    if (/request entity too large/i.test(text)) {
      return cabinetUploadTooLargeMessage();
    }
    if (res.status === 413) return cabinetUploadTooLargeMessage();
    const oneLine = text.replace(/\s+/g, ' ').trim().slice(0, 240);
    return oneLine || fallback;
  }
}
