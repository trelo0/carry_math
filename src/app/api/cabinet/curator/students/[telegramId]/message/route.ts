import { NextResponse } from 'next/server';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { telegramSend } from '@/lib/telegram';

type RouteParams = { params: Promise<{ telegramId: string }> };
type Body = { text?: string };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }

  try {
    const { data: member, error } = await auth.admin
      .from('bot_members')
      .select('chat_id')
      .eq('telegram_id', studentTelegramId)
      .maybeSingle();
    if (error) throw error;

    const chatId = member?.chat_id as number | undefined;
    if (!chatId) {
      return NextResponse.json(
        { error: 'У ученика нет chat_id — он ещё не писал боту.' },
        { status: 400 },
      );
    }

    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `💬 Сообщение от куратора District\n\n${text}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to send message');
  }
}
