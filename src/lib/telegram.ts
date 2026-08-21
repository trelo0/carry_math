const API = 'https://api.telegram.org';

type TelegramResponse = {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
};

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

export function sendOtpMessage(chatId: number, code: string) {
  return telegramSend('sendMessage', {
    chat_id: chatId,
    text: `🔑 Ваш код для входа: *${code}*\n\nДействует 5 минут. Никому не сообщайте этот код.`,
    parse_mode: 'Markdown',
  });
}
