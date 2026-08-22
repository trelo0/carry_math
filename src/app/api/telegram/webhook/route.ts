import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maskPhone } from '@/lib/phone';
import { telegramSend } from '@/lib/telegram';
import {
  renderMainMenu,
  handleGuestCallback,
  handleGuestTextMessage,
} from '@/lib/bot/guestFlow';
import {
  handleAdminCallback,
  handleAdminDocument,
  handleAdminMessage,
  sendAdminStart,
} from '@/lib/bot/admin';
import { analyzeUserMessage, enforceModerationRestrictions } from '@/lib/bot/moderation';
import { handleStudentMessage, sendStudentStart } from '@/lib/bot/studentFlow';
import { handleTeacherCallback, handleTeacherMessage, sendTeacherStart } from '@/lib/bot/teacher';
import {
  handleCuratorAttachment,
  handleCuratorCallback,
  handleCuratorMessage,
  sendCuratorStart,
} from '@/lib/bot/curator';

import {
  ensureMember,
  getMember,
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

// mentor — устаревший синоним curator: в подсказках команд его не предлагаем.
const ASSIGNABLE_ROLE_NAMES = Object.keys(ROLE_LABELS).filter((role) => role !== 'mentor');

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
      message_id?: number;
            from?: TgFrom;
      reply_to_message?: { from?: TgFrom };
      document?: {
        file_id?: string;
        file_name?: string;
        mime_type?: string;
      };
      // Массив размеров фото; последний элемент — максимальный размер.
      photo?: Array<{ file_id?: string }>;
      // Голосовое сообщение (комментарий ментора при отклонении ДЗ, mock).
      voice?: { file_id?: string };
	
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
    const admin = createAdminClient();

    // Контроль доступа (§20): заблокированные и ограниченные пользователи
    // не получают доступ ни через сообщения, ни через команды, ни через
    // кнопки. Проверка стоит ДО всех веток, чтобы блокировку нельзя было
    // обойти. Администраторы исключены — они управляют панелью.
    const enforced = await enforceModerationRestrictions(admin, {
      telegramId: update.message?.from?.id ?? update.callback_query?.from?.id,
      chatId: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id,
      callbackQueryId: update.callback_query?.id,
    });
    if (enforced) return NextResponse.json({ ok: true });

    // /start webinar — рекламный deep link. Параметр зарезервирован, никогда не проверяется как токен привязки и открывает гостевое главное меню.
    if (
      update.message?.text === '/start webinar' &&
      update.message.chat &&
      update.message.from
    ) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await renderMainMenu(update.message.chat.id);
      return NextResponse.json({ ok: true });
    }

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

        // /start, /menu и /admin — регистрация/обновление участника и актуальное
    // главное меню по роли (с Reply Keyboard у админа).
    if (
      (update.message?.text === '/start' ||
        update.message?.text === '/menu' ||
        update.message?.text === '/admin') &&
      update.message.chat &&
      update.message.from
    ) {
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
        // Тестер в маске admin не получает доступ к операциям с вебинарами.
        if (member.role === 'admin') {
          await sendAdminStart(update.message.chat.id, testFooter);
        } else {
          await telegramSend('sendMessage', {
            chat_id: update.message.chat.id,
            text:
              '👋 Привет! Ты админ бота District.\n\n' +
              '/users — список участников\n' +
              '/role <id> <роль> — сменить роль (или ответом на сообщение)\n' +
              '/id — узнать свой Telegram ID' +
              testFooter,
          });
        }

      } else if (role === 'curator') {
        // Кабинет ментора: Reply Keyboard + inline-экраны на MOCK-данных.
        await sendCuratorStart(update.message.chat.id, testFooter);
      } else if (role === 'student') {
        // Динамическое меню ученика: разделы строятся из активных
        // продуктовых доступов (user_accesses), а не из роли.
        await sendStudentStart(admin, from.id, update.message.chat.id, testFooter);
      } else if (role === 'teacher') {
        // Кабинет преподавателя: Reply Keyboard + inline-экраны на MOCK-данных.
        await sendTeacherStart(update.message.chat.id, testFooter);
            } else {
        await renderMainMenu(update.message.chat.id, testFooter);
      }

      return NextResponse.json({ ok: true });
    }

        // /as имеет приоритет над любыми диалоговыми состояниями: тестер всегда может сбросить маску.
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

      // mentor — устаревший синоним curator: включаем маску куратора.
      const maskRole = arg === 'mentor' ? 'curator' : arg;
      if (!isBotRole(maskRole)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: `Формат: /as <роль> или /as reset. Роли: ${ASSIGNABLE_ROLE_NAMES.join(', ')}.`,
        });
        return NextResponse.json({ ok: true });
      }

      await setViewRole(admin, update.message.from.id, maskRole);
      await telegramSend('sendMessage', {
        chat_id: update.message.chat.id,
        text: `🧪 Включена маска «${ROLE_LABELS[maskRole]}». Напиши /start — увидишь бот глазами этой роли.`,
      });
      return NextResponse.json({ ok: true });
    }

    // Вложения админа (документ или фото): шаблон уведомления или рассылка.
    if (update.message?.document?.file_id && update.message.chat && update.message.from) {
      const handled = await handleAdminDocument(
        admin,
        update.message.from.id,
        update.message.chat.id,
        {
          fileId: update.message.document.file_id,
          fileName: update.message.document.file_name,
          mimeType: update.message.document.mime_type,
          kind: 'document',
        },
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    if (update.message?.photo?.length && update.message.chat && update.message.from) {
      const largest = update.message.photo[update.message.photo.length - 1];
      if (largest?.file_id) {
        const handled = await handleAdminDocument(
          admin,
          update.message.from.id,
          update.message.chat.id,
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (handled) return NextResponse.json({ ok: true });
      }
    }

    // Вложения ментора (голосовое или фото): комментарий при отклонении ДЗ
    // в mock-режиме. Стоит после админских вложений (админ в приоритете),
    // ученику ничего не отправляется.
    if (
      (update.message?.voice?.file_id || update.message?.photo?.length) &&
      update.message.chat &&
      update.message.from
    ) {
      const largest = update.message.photo?.[update.message.photo.length - 1];
      const curatorHandled = await handleCuratorAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.voice?.file_id ? 'voice' : largest?.file_id ? 'photo' : 'photo',
      );
      if (curatorHandled) return NextResponse.json({ ok: true });
    }

    // Текстовые ответы для шаблонов уведомлений и пошагового создания/редактирования вебинара.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const handled = await handleAdminMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    // Кнопки Reply Keyboard ученика: обрабатываются до контроля переписки,
    // чтобы нажатия разделов не анализировались детектором.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const handled = await handleStudentMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    // Reply Keyboard преподавателя: разделы меню и ввод «сообщения ученику».
    // Стоит до контроля переписки, чтобы нажатия кнопок и черновики
    // сообщений не анализировались детектором.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const handled = await handleTeacherMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    // Reply Keyboard ментора: разделы меню и текстовый комментарий
    // при отклонении ДЗ. До контроля переписки, чтобы черновики
    // комментариев не анализировались детектором.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const handled = await handleCuratorMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (handled) return NextResponse.json({ ok: true });
    }

    // Контроль переписки (§1): текст не-админов проверяется ДО дальнейшей
    // обработки. HIGH-сообщение не передаётся дальше: создаётся событие,
    // отправитель получает отказ, администраторы — уведомление.
    // Сообщения админов, команды (/...) и callback_query не анализируем.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const sender = await getMember(admin, update.message.from.id);
      if (sender?.role !== 'admin') {
        const analysis = await analyzeUserMessage(admin, {
          telegramId: update.message.from.id,
          chatId: update.message.chat.id,
          messageId: update.message.message_id ?? 0,
          text: update.message.text,
          fallbackName: fullName(update.message.from),
        });
        if (analysis.blocked) return NextResponse.json({ ok: true });
      }
    }

    // Inline-кнопки админского и гостевого меню.
    const callbackQuery = update.callback_query;
    const callbackMessage = callbackQuery?.message;
    if (
      callbackQuery?.data &&
      callbackMessage?.chat?.id &&
      callbackMessage.message_id &&
      callbackQuery.from?.id
    ) {
      const { data, from, id } = callbackQuery;
      const chatId = callbackMessage.chat.id;
      const messageId = callbackMessage.message_id;
      const adminHandled = await handleAdminCallback(
        admin,
        data,
        { chatId, messageId },
        from.id,
        id,
      );
      if (adminHandled) return NextResponse.json({ ok: true });

      const guestHandled = await handleGuestCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (guestHandled) return NextResponse.json({ ok: true });

      // Inline-навигация кабинета преподавателя (префикс t:).
      const teacherHandled = await handleTeacherCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (teacherHandled) return NextResponse.json({ ok: true });

      // Inline-навигация кабинета ментора (префикс c:).
      const curatorHandled = await handleCuratorCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (curatorHandled) return NextResponse.json({ ok: true });
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

      // mentor — устаревший синоним curator: назначаем куратора.
      if (roleArg === 'mentor') roleArg = 'curator';

      if (!targetId || !isBotRole(roleArg)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: `Формат: /role <id> <роль>. Роли: ${ASSIGNABLE_ROLE_NAMES.join(', ')}.`,
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

        // Обычный текст гостя не запускает новый сценарий: старые кнопки деактивируются.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const member = await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      const guestView = member.role === 'guest' || (member.role === 'test' && member.viewRole === 'guest');
      if (guestView) {
        await handleGuestTextMessage(update.message.chat.id);
        return NextResponse.json({ ok: true });
      }
    }

  } catch (error) {
    console.error('Telegram webhook error:', error);
  }

  // Telegram ждёт быстрый 200, иначе будет ретраить.
  return NextResponse.json({ ok: true });
}
