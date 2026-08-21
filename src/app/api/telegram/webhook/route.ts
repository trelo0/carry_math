import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maskPhone } from '@/lib/phone';
import { telegramSend } from '@/lib/telegram';
import { guestStart, handleGuestCallback } from '@/lib/bot/guestFlow';

import {
  ensureMember,
  isAdminEnv,
  isBotRole,
  listMembers,
  setRole,
  setViewRole,
  ROLE_LABELS,
  type BotRole,
} from '@/lib/bot/roles';

type TgFrom = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

function fullName(from: TgFrom): string | undefined {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return name || (from.username ? `@${from.username}` : undefined);
}

function memberPatch(from: TgFrom, chatId: number) {
  return {
    chat_id: chatId,
    full_name: fullName(from),
  };
}

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
      from?: TgFrom;
      document?: {
        file_id: string;
        file_name?: string;
      };

      reply_to_message?: { from?: TgFrom };
    };
    callback_query?: {
      id?: string;
      data?: string;
      from?: TgFrom;
      message?: { chat?: { id: number }; message_id?: number };
    };
  } | null;

  if (!update) return NextResponse.json({ ok: true });

    try {
    // Временная диагностика: PDF из Telegram не скачивается и не сохраняется.
    const document = update.message?.document;
    if (document?.file_id) {
      console.info('Telegram document received:', {
        file_id: document.file_id,
        file_name: document.file_name ?? '(без имени файла)',
      });
      return NextResponse.json({ ok: true });
    }

    const admin = createAdminClient();

    // /start <token> — пользователь пришёл с сайта по кнопке «Подключить Telegram».

    if (update.message?.text?.startsWith('/start ') && update.message.chat) {
      const token = update.message.text.slice('/start '.length).trim();
            if (update.message.from) {
        await ensureMember(
          admin,
          update.message.from.id,
          memberPatch(update.message.from, update.message.chat.id),
        );
      }

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
         text:
  '👋 Добро пожаловать в онлайн-школу математики District!\n\n' +
  'Это официальный бот онлайн-школы.\n\n' +
  'Чтобы использовать Telegram для входа в личный кабинет, необходимо подключить аккаунт.\n\n' +
  `Привязать этот Telegram к номеру ${maskPhone(row.phone)}?`,
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
          await ensureMember(admin, telegramId, {
            phone: row.phone,
            ...(update.callback_query.from && chatId
              ? memberPatch(update.callback_query.from, chatId)
              : {}),
          });

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

        // Просто /start — регистрация/обновление участника и меню по роли.
    if (update.message?.text === '/start' && update.message.chat && update.message.from) {
      const from = update.message.from;
      const member = await ensureMember(
        admin,
        from.id,
        memberPatch(from, update.message.chat.id),
      );

      const masked =
        member.role === 'test' && member.viewRole && member.viewRole !== 'test'
          ? member.viewRole
          : null;
      const role: BotRole = masked ?? member.role;
      const testFooter = masked
        ? `\n\n🧪 Тест-маска: ${ROLE_LABELS[masked]}. Сброс — /as reset.`
        : '';

      // Тестер без маски — отдельное меню.
      if (member.role === 'test' && !masked) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text:
            '🧪 Привет! Ты тестер District.\n\n' +
            '/as <роль> — посмотреть бот глазами роли (guest, student, curator, admin)\n' +
            '/as reset — сбросить маску\n' +
            '/users — список участников\n' +
            '/role <id> <роль> — сменить роль\n' +
            '/id — твой Telegram ID',
        });
        return NextResponse.json({ ok: true });
      }

      if (role === 'admin') {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text:
            '👋 Привет! Ты админ бота District.\n\n' +
            '/users — список участников\n' +
            '/role <id> <роль> — сменить роль (или ответом на сообщение)\n' +
            '/id — узнать свой Telegram ID' +
            testFooter,
        });
      } else if (role === 'curator') {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: '👋 Привет! Ты куратор District.\nИнструменты куратора появятся здесь совсем скоро.' + testFooter,
        });
      } else if (role === 'student') {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text:
            '👋 Привет! Ты ученик District.\n' +
            '🔑 Коды для входа приходят сюда.\n' +
            'Домашки и расписание — скоро.' + testFooter,
        });
            } else {
        await guestStart(update.message.chat.id, testFooter);
      }

      return NextResponse.json({ ok: true });
    }

        // Кнопки гостевого меню и внутренних сценариев.
    if (
      update.callback_query?.data &&
      update.callback_query.message?.chat?.id &&
      update.callback_query.from?.id
    ) {
      const handled = await handleGuestCallback(
        admin,
        update.callback_query.data,
        update.callback_query.message.chat.id,
        update.callback_query.from.id,
        update.callback_query.id,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    // /id — показать свой Telegram ID (удобно для назначения ролей).

    if (update.message?.text === '/id' && update.message.chat && update.message.from) {
      await telegramSend('sendMessage', {
        chat_id: update.message.chat.id,
        text: `Твой Telegram ID: ${update.message.from.id}`,
      });
      return NextResponse.json({ ok: true });
    }

    // /users — список участников (только админ).
    if (update.message?.text === '/users' && update.message.chat && update.message.from) {
      const caller = await ensureMember(admin, update.message.from.id, {});
      if (caller.role !== 'admin' && caller.role !== 'test' && !isAdminEnv(update.message.from.id)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Недостаточно прав.',
        });
      } else {
        const members = await listMembers(admin);
        const lines = members.map(
          (m) =>
            `${m.telegram_id} · ${ROLE_LABELS[m.role as BotRole] ?? m.role} · ${m.phone ?? m.full_name ?? ''}`,
        );
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: lines.length > 0 ? lines.join('\n') : 'Пока никого нет.',
        });
      }
      return NextResponse.json({ ok: true });
    }

    // /role <id> <роль> или ответом на сообщение: /role <роль> (только админ).
    if (update.message?.text?.startsWith('/role') && update.message.chat && update.message.from) {
      const caller = await ensureMember(admin, update.message.from.id, {});
      if (caller.role !== 'admin' && caller.role !== 'test' && !isAdminEnv(update.message.from.id)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Недостаточно прав.',
        });
        return NextResponse.json({ ok: true });
      }

      const args = update.message.text.slice('/role'.length).trim().split(/\s+/).filter(Boolean);
      let targetId: number | null = null;
      let roleArg = '';
      if (args.length >= 2 && /^\d+$/.test(args[0])) {
        targetId = Number(args[0]);
        roleArg = args[1];
      } else if (args.length === 1) {
        targetId = update.message.reply_to_message?.from?.id ?? null;
        roleArg = args[0];
      }

      if (!targetId || !isBotRole(roleArg)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: `Формат: /role <id> <роль>. Роли: ${Object.keys(ROLE_LABELS).join(', ')}.`,
        });
        return NextResponse.json({ ok: true });
      }

      // Роль test — только для владельца из ADMIN_TELEGRAM_IDS.
      if (roleArg === 'test' && !isAdminEnv(update.message.from.id)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Роль test назначается только владельцу.',
        });
        return NextResponse.json({ ok: true });
      }

      const found = await setRole(admin, targetId, roleArg);
      await telegramSend('sendMessage', {
        chat_id: update.message.chat.id,
        text: found
          ? `✅ Роль «${ROLE_LABELS[roleArg as BotRole]}» установлена для ${targetId}.`
          : 'Такого участника нет — пусть сначала напишет боту.',
      });
      return NextResponse.json({ ok: true });
    }

    // /as <роль> — тест-маска: посмотреть бот глазами роли (только роль test).
    if (update.message?.text?.startsWith('/as') && update.message.chat && update.message.from) {
      const member = await ensureMember(admin, update.message.from.id, {});
      if (member.role !== 'test' && !isAdminEnv(update.message.from.id)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Недостаточно прав.',
        });
        return NextResponse.json({ ok: true });
      }

      const arg = update.message.text.slice('/as'.length).trim();
      if (arg === 'reset' || arg === '') {
        await setViewRole(admin, update.message.from.id, null);
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: '🧪 Маска сброшена — ты снова тестер.',
        });
        return NextResponse.json({ ok: true });
      }

      if (!isBotRole(arg)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: `Формат: /as <роль> или /as reset. Роли: ${Object.keys(ROLE_LABELS).join(', ')}.`,
        });
        return NextResponse.json({ ok: true });
      }

      await setViewRole(admin, update.message.from.id, arg);
      await telegramSend('sendMessage', {
        chat_id: update.message.chat.id,
        text: `🧪 Включена маска «${ROLE_LABELS[arg as BotRole]}». Напиши /start — увидишь бот глазами этой роли.`,
      });
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error('Telegram webhook error:', error);
  }

  // Telegram ждёт быстрый 200, иначе будет ретраить.
  return NextResponse.json({ ok: true });
}
