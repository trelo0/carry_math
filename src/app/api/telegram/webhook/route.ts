import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maskPhone } from '@/lib/phone';
import { telegramSend } from '@/lib/telegram';

// Вебхук Telegram-бота: привязка Telegram к номеру телефона.
// Telegram ID принимается только из update от самого Telegram
// (вебхук защищён secret-заголовком), никогда из клиентских запросов.
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = request.headers.get('x-telegram-bot-api-secret-token');
    if (got !== secret) {
      return new NextResponse(null, { status: 403 });
    }
  }

  const update = (await request.json().catch(() => null)) as {
    message?: {
      text?: string;
      chat?: { id: number };
      from?: { id: number };
    };
    callback_query?: {
      id?: string;
      data?: string;
      from?: { id: number };
      message?: { chat?: { id: number }; message_id?: number };
    };
  } | null;

  if (!update) return NextResponse.json({ ok: true });

  try {
    const admin = createAdminClient();

    // /start <token> — пользователь пришёл с сайта по кнопке «Подключить Telegram».
    if (update.message?.text?.startsWith('/start ') && update.message.chat) {
      const token = update.message.text.slice('/start '.length).trim();
      const { data: row } = await admin
        .from('telegram_link_tokens')
        .select('phone, used_at, expires_at')
        .eq('token', token)
        .maybeSingle();

      const valid =
        row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();

      if (!valid) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Эта ссылка недействительна или уже использована. Запроси подключение заново на сайте.',
        });
      } else {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: `Привязать этот Telegram к аккаунту ${maskPhone(row.phone)}?`,
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Подключить аккаунт', callback_data: `link:${token}` }],
            ],
          },
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Нажатие кнопки «Подключить аккаунт».
    if (update.callback_query?.data?.startsWith('link:')) {
      const token = update.callback_query.data.slice('link:'.length);
      const telegramId = update.callback_query.from?.id;
      const chatId = update.callback_query.message?.chat?.id;

      if (telegramId) {
        const { data: row } = await admin
          .from('telegram_link_tokens')
          .select('phone, used_at, expires_at')
          .eq('token', token)
          .maybeSingle();

        const valid =
          row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();

        if (valid) {
          // Привязка phone → telegram_id; токен сгорает.
          await admin
            .from('telegram_links')
            .upsert(
              { phone: row.phone, telegram_id: telegramId, linked_at: new Date().toISOString() },
              { onConflict: 'phone' },
            );
          await admin
            .from('telegram_link_tokens')
            .update({ used_at: new Date().toISOString() })
            .eq('token', token);

          await telegramSend('answerCallbackQuery', {
            callback_query_id: update.callback_query.id,
            text: 'Telegram подключён!',
          });
          if (chatId && update.callback_query.message?.message_id) {
            await telegramSend('editMessageText', {
              chat_id: chatId,
              message_id: update.callback_query.message.message_id,
              text: `✅ Telegram подключён к аккаунту ${maskPhone(row.phone)}.\nВернись на сайт и нажми «Я подключил — отправить код».`,
            });
          }
        } else {
          await telegramSend('answerCallbackQuery', {
            callback_query_id: update.callback_query.id,
            text: 'Ссылка недействительна. Запроси подключение на сайте заново.',
            show_alert: true,
          });
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Просто /start — приветствие.
    if (update.message?.text === '/start' && update.message.chat) {
      await telegramSend('sendMessage', {
        chat_id: update.message.chat.id,
        text: 'Это бот Math School. Здесь ты получаешь коды для входа на сайт. Подключи Telegram к аккаунту через кнопку на сайте.',
      });
    }
  } catch (error) {
    console.error('Telegram webhook error:', error);
  }

  // Telegram ждёт быстрый 200, иначе будет ретраить.
  return NextResponse.json({ ok: true });
}
