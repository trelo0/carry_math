import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.telegram.org';

type TelegramResponse = { ok: boolean; description?: string };

function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не настроен');
  return token;
}

// Все вызовы Bot API — только с сервера, токен никогда не уходит в браузер.
export async function telegramSend(
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramResponse> {
  const res = await fetch(`${API}/bot${getTelegramToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as TelegramResponse;
}

// Загружает файл с диска сервера в Telegram как вложение к сообщению.
// Файл не требуется публиковать по URL сайта.
export async function telegramSendLocalDocument(
  chatId: number,
  fileName: string,
  caption?: string,
): Promise<TelegramResponse> {
  const publicDir = path.resolve(process.cwd(), 'public');
  const filePath = path.resolve(publicDir, fileName);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('PDF-файл должен находиться в папке public');
  }

  const file = await readFile(filePath);
  const formData = new FormData();
  formData.set('chat_id', String(chatId));
  formData.set(
    'document',
    new Blob([new Uint8Array(file)], { type: 'application/pdf' }),
    path.basename(fileName),
  );
  if (caption) formData.set('caption', caption);

  const res = await fetch(`${API}/bot${getTelegramToken()}/sendDocument`, {
    method: 'POST',
    body: formData,
  });
  return (await res.json()) as TelegramResponse;
}

export function sendOtpMessage(chatId: number, code: string) {
  return telegramSend('sendMessage', {
    chat_id: chatId,
    text: `🔑 Ваш код для входа: *${code}*\n\nДействует 5 минут. Никому не сообщайте этот код.`,
    parse_mode: 'Markdown',
  });
}
