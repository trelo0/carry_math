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
import { beginStudentPurchase, handleStudentPurchaseCallback, parsePayStartPayload } from '@/lib/bot/studentPurchaseFlow';
import {
  beginCourseHomeworkSubmit,
  handleStudentHomeworkAttachment,
  handleStudentHomeworkMessage,
} from '@/lib/bot/studentHomeworkFlow';
import {
  beginStudentMentorQuestion,
  handleStudentMentorAttachment,
  handleStudentMentorMessage,
} from '@/lib/bot/studentMentorFlow';
import {
  beginStudentSupport,
  handleStudentSupportAttachment,
  handleStudentSupportMessage,
} from '@/lib/bot/studentSupportFlow';
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
  isCreatorTelegramId,
  canUseTesterTools,
  resolveEffectiveRoleWithFooter,
} from '@/lib/bot/roles';
import {
  beginCourseApplication,
  handleCourseApplyContact,
  handleCourseApplyPhoneMessage,
  tryCompleteCourseApplyAfterExternalLink,
} from '@/lib/bot/courseApplyFlow';
import { handlePrivilegedBotCommands } from '@/lib/bot/privilegedCommands';
import { linkTelegramToPhone } from '@/lib/bot/telegram-account-link';
import { isAccessProduct } from '@/lib/bot/accesses';

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
      message_id?: number;
            from?: TgFrom;
      reply_to_message?: { from?: TgFrom };
      caption?: string;
      document?: {
        file_id?: string;
        file_name?: string;
        mime_type?: string;
      };
      // Массив размеров фото; последний элемент — максимальный размер.
      photo?: Array<{ file_id?: string }>;
      // Голосовое сообщение (комментарий ментора при отклонении ДЗ, mock).
      voice?: { file_id?: string };
      contact?: {
        phone_number?: string;
        user_id?: number;
        first_name?: string;
        last_name?: string;
      };
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

    if (update.message) {
      const privilegedHandled = await handlePrivilegedBotCommands(admin, update.message);
      if (privilegedHandled) return NextResponse.json({ ok: true });
    }

    // /start <источник> — рекламный deep link (webinar, insta и т.д.).
    // Параметры зарезервированы, никогда не проверяются как токен привязки
    // и открывают гостевое главное меню.
    const AD_START_SOURCES = ['webinar', 'insta', 'ads', 'vk'];
    const startSource = update.message?.text?.startsWith('/start ')
      ? update.message.text.slice('/start '.length).trim()
      : null;
    if (
      startSource !== null &&
      AD_START_SOURCES.includes(startSource) &&
      update.message?.chat &&
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

    // /start course_apply — заявка на курс с главной страницы сайта.
    if (
      startSource === 'course_apply' &&
      update.message?.chat &&
      update.message.from
    ) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginCourseApplication(admin, update.message.from.id, update.message.chat.id);
      return NextResponse.json({ ok: true });
    }

    // /start pay_<product>[_<pkg>_<teacher>] — покупка из кабинета.
    if (
      startSource?.startsWith('pay_') &&
      update.message?.chat &&
      update.message.from
    ) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      const options = parsePayStartPayload(startSource);
      if (options.product && isAccessProduct(options.product)) {
        await beginStudentPurchase(admin, update.message.from.id, update.message.chat.id, options);
      } else {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: 'Неизвестный продукт. Открой раздел «Оплаты» в личном кабинете на сайте.',
        });
      }
      return NextResponse.json({ ok: true });
    }

    // /start support — обращение в поддержку из кабинета.
    if (startSource === 'support' && update.message?.chat && update.message.from) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginStudentSupport(admin, update.message.from.id, update.message.chat.id);
      return NextResponse.json({ ok: true });
    }

    // /start mentor — вопрос или домашка наставнику из кабинета.
    if (startSource === 'mentor' && update.message?.chat && update.message.from) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginStudentMentorQuestion(admin, update.message.from.id, update.message.chat.id);
      return NextResponse.json({ ok: true });
    }

    // /start mentor_hw — сдать домашку ind/group через наставника.
    if (startSource === 'mentor_hw' && update.message?.chat && update.message.from) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginStudentMentorQuestion(admin, update.message.from.id, update.message.chat.id, {
        homework: true,
      });
      return NextResponse.json({ ok: true });
    }

    // /start hw_<sanityLessonId> — сдача домашки из личного кабинета.
    if (
      startSource?.startsWith('hw_') &&
      update.message?.chat &&
      update.message.from
    ) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginCourseHomeworkSubmit(
        admin,
        update.message.from.id,
        update.message.chat.id,
        startSource.slice('hw_'.length),
      );
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
          await linkTelegramToPhone(admin, telegramId, row.phone as string, {
            fullName: update.callback_query.from
              ? fullName(update.callback_query.from)
              : undefined,
          });
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
              text: `✅ Telegram подключён к аккаунту ${maskPhone(row.phone as string)}.\nВернись на сайт и нажми «Я подключил — отправить код».`,
            });
          }
          if (chatId) {
            await tryCompleteCourseApplyAfterExternalLink(admin, telegramId, chatId);
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

      const { role, testFooter } = resolveEffectiveRoleWithFooter(member, from.id);
      const testerTools = canUseTesterTools(from.id, member.role);
      const hasMask = member.viewRole && member.viewRole !== member.role;
      const creatorHint =
        testerTools && !hasMask
          ? isCreatorTelegramId(from.id)
            ? '\n\n🛠 /as <роль> — UI другой роли · /role me <роль> — сменить себе роль · /role reset — вернуть admin'
            : '\n\n🛠 /as <роль> — UI другой роли · /role me <роль> — сменить себе роль'
          : '';
      const footer = testFooter + creatorHint;
      if (isAdminEnv(from.id) && update.message.text === '/admin') {
        await sendAdminStart(update.message.chat.id, footer);
      } else if (role === 'admin') {
        if (member.role === 'admin' || isAdminEnv(from.id)) {
          await sendAdminStart(update.message.chat.id, footer);
        } else {
          await telegramSend('sendMessage', {
            chat_id: update.message.chat.id,
            text:
              '👋 Привет! Ты админ бота District.\n\n' +
              '/users — список участников\n' +
              '/role me <роль> — сменить свою роль\n' +
              '/role <id> <роль> — сменить роль участника\n' +
              '/id — узнать свой Telegram ID' +
              footer,
          });
        }
      } else if (role === 'curator') {
        await sendCuratorStart(update.message.chat.id, footer);
      } else if (role === 'student') {
        await sendStudentStart(admin, from.id, update.message.chat.id, footer);
      } else if (role === 'teacher') {
        await sendTeacherStart(update.message.chat.id, footer);
      } else {
        await renderMainMenu(update.message.chat.id, footer);
      }

      return NextResponse.json({ ok: true });
    }

    // Вложения админа (документ или фото): шаблон уведомления или рассылка.
    if (update.message?.document?.file_id && update.message.chat && update.message.from) {
      const studentDocHandled = await handleStudentHomeworkAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        {
          fileId: update.message.document.file_id,
          kind: 'document',
          fileName: update.message.document.file_name,
        },
      );
      if (studentDocHandled) return NextResponse.json({ ok: true });

      const mentorDocHandled = await handleStudentMentorAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? update.message.document.file_name ?? 'Документ',
      );
      if (mentorDocHandled) return NextResponse.json({ ok: true });

      const supportDocHandled = await handleStudentSupportAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? update.message.document.file_name ?? 'Документ',
      );
      if (supportDocHandled) return NextResponse.json({ ok: true });

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
        const studentPhotoHandled = await handleStudentHomeworkAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (studentPhotoHandled) return NextResponse.json({ ok: true });

        const mentorPhotoHandled = await handleStudentMentorAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? 'Фото',
        );
        if (mentorPhotoHandled) return NextResponse.json({ ok: true });

        const supportPhotoHandled = await handleStudentSupportAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? 'Фото',
        );
        if (supportPhotoHandled) return NextResponse.json({ ok: true });

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
      const curatorFileId = update.message.voice?.file_id ?? largest?.file_id;
      const curatorHandled =
        curatorFileId &&
        (await handleCuratorAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.voice?.file_id ? 'voice' : 'photo',
          curatorFileId,
        ));
      if (curatorHandled) return NextResponse.json({ ok: true });
    }

    if (
      update.message?.contact &&
      update.message.chat &&
      update.message.from
    ) {
      const courseContactHandled = await handleCourseApplyContact(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.contact,
      );
      if (courseContactHandled) return NextResponse.json({ ok: true });
    }

    // Текстовые ответы для шаблонов уведомлений и пошагового создания/редактирования вебинара.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const courseApplyHandled = await handleCourseApplyPhoneMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (courseApplyHandled) return NextResponse.json({ ok: true });

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
      const hwHandled = await handleStudentHomeworkMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (hwHandled) return NextResponse.json({ ok: true });

      const mentorHandled = await handleStudentMentorMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (mentorHandled) return NextResponse.json({ ok: true });

      const supportHandled = await handleStudentSupportMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (supportHandled) return NextResponse.json({ ok: true });

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
      if (sender?.role !== 'admin' && !isAdminEnv(update.message.from.id)) {
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

      const purchaseHandled = await handleStudentPurchaseCallback(
        admin,
        data,
        { chatId, messageId },
        from.id,
        id,
      );
      if (purchaseHandled) return NextResponse.json({ ok: true });

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
      const effective = resolveEffectiveRoleWithFooter(member, update.message.from.id).role;
      const guestView = effective === 'guest';
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
