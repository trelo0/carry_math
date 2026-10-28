import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maskPhone } from '@/lib/phone';
import { telegramSend } from '@/lib/telegram';
import { renderMainMenu, handleGuestCallback } from '@/lib/bot/guestFlow';
import {
  handleAdminCallback,
  handleAdminDocument,
  handleAdminMessage,
  sendAdminStart,
} from '@/lib/bot/admin';
import { ADMIN_REPLY_LABEL_SET } from '@/lib/bot/admin/core';
import { analyzeUserMessage, enforceModerationRestrictions } from '@/lib/bot/moderation';
import { handleStudentMessage } from '@/lib/bot/studentFlow';
import { beginStudentPurchase, handleStudentPurchaseCallback, parsePayStartPayload } from '@/lib/bot/studentPurchaseFlow';
import {
  beginCourseHomeworkSubmit,
  handleCourseHomeworkCallback,
  handleStudentHomeworkAttachment,
  handleStudentHomeworkMessage,
} from '@/lib/bot/studentHomeworkFlow';
import { showClientCourseHomeworkLessonStatus } from '@/lib/bot/client-course-homework-hub';
import {
  beginStudentMentorQuestion,
  handleStudentMentorAttachment,
  handleStudentMentorCallback,
  handleStudentMentorMessage,
} from '@/lib/bot/studentMentorFlow';
import {
  beginStudentSupport,
  handleStudentSupportAttachment,
  handleStudentSupportMessage,
} from '@/lib/bot/studentSupportFlow';
import {
  handleStudentStaffDmAttachment,
  handleStudentStaffDmMessage,
} from '@/lib/bot/student-staff-dm-thread';
import {
  handleTeacherAttachment,
  handleTeacherCallback,
  handleTeacherMessage,
  sendTeacherStart,
} from '@/lib/bot/teacher';
import { handleCombinedStaffCallback, handleCombinedStaffMessage, sendStaffStart } from '@/lib/bot/staff/staff-combined-flow';
import {
  handleStaffCourseHubCallback,
  handleStaffGlobalMenuMessage,
  handleStaffWorkspaceMenuMessage,
} from '@/lib/bot/staff/staff-course-hub-flow';
import { handleCheckAttachment, handleCheckCallback, handleCheckMessage } from '@/lib/bot/check/check-flow';
import { clearBotWizardStateOnMenuStart } from '@/lib/bot/conversation-reset';
import {
  handleCuratorAttachment,
  handleCuratorCallback,
  handleCuratorMessage,
  sendCuratorStart,
} from '@/lib/bot/curator';
import { scheduleHomeworkDeadlineSweep } from '@/lib/bot/education/homework-deadline-sweep';

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
  handleCourseApplyCallback,
  handleCourseApplyContact,
  handleCourseApplyPhoneMessage,
  tryCompleteCourseApplyAfterExternalLink,
} from '@/lib/bot/courseApplyFlow';
import { handlePrivilegedBotCommands } from '@/lib/bot/privilegedCommands';
import { linkTelegramToPhone } from '@/lib/bot/telegram-account-link';
import { isAccessProduct } from '@/lib/bot/accesses';
import {
  handleClientCallback,
  handleClientMessage,
  handleClientReplyMenuNavigation,
  handleClientUnknownText,
  refreshClientMenu,
  sendClientStart,
} from '@/lib/bot/client-flow';
import { isClientReplyLabel } from '@/lib/bot/client-menu';
import { recordInboundClientMessage, recordInboundClientMedia } from '@/lib/bot/admin/lead-inbound';
import { usesClientBotUi } from '@/lib/bot/client-state';
import {
  CLIENT_LESSONS_BOT_DISABLED_TEXT,
  CLIENT_LESSONS_BOT_UI_ENABLED,
} from '@/lib/bot/client-lessons-ui-flag';
import { handleClientLegacyReply } from '@/lib/bot/client-legacy-reply';
import { bridgeGuestCallbackForClient } from '@/lib/bot/client-guest-bridge';
import { getState } from '@/lib/bot/admin/core';
import { CLIENT_DIALOG_STEPS } from '@/lib/bot/client-nav';
import {
  extractBotStartPayload,
  isCourseHomeworkStartPayload,
  isCourseHomeworkStatusStartPayload,
  isPlainBotStartCommand,
  parseCourseHomeworkStatusTelegramStart,
  parseCourseHomeworkTelegramStart,
} from '@/lib/bot/course-homework-deeplink';

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
    update_id?: number;
    message?: {
            text?: string;
      chat?: { id: number; type?: string };
      message_id?: number;
            from?: TgFrom & { is_bot?: boolean };
      reply_to_message?: { from?: TgFrom };
      caption?: string;
      is_topic_message?: boolean;
      message_thread_id?: number;
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

  const admin = createAdminClient();

    try {

    const { tryClaimTelegramUpdate } = await import('@/lib/bot/staff/dm-topics');
    const claimOk = await tryClaimTelegramUpdate(admin, update.update_id);
    if (!claimOk) return NextResponse.json({ ok: true });

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

    if (update.message?.is_topic_message && update.message.message_thread_id && update.message.from) {
      const { handleStaffDmTopicInboundMessage } = await import(
        '@/lib/bot/staff/staff-dm-topic-inbound'
      );
      const topicHandled = await handleStaffDmTopicInboundMessage(admin, update.message);
      if (topicHandled) return NextResponse.json({ ok: true });
    }

    if (update.message) {
      const privilegedHandled = await handlePrivilegedBotCommands(admin, update.message);
      if (privilegedHandled) return NextResponse.json({ ok: true });
    }

    // /start <источник> — рекламный deep link (webinar, insta и т.д.).
    // Параметры зарезервированы, никогда не проверяются как токен привязки
    // и открывают гостевое главное меню.
    const AD_START_SOURCES = ['webinar', 'insta', 'ads', 'vk'];
    const startMessage = update.message;
    const startSource = startMessage?.text ? extractBotStartPayload(startMessage.text) : null;

    async function runCourseHomeworkStatusDeepLink(): Promise<boolean> {
      if (
        startSource == null ||
        !isCourseHomeworkStatusStartPayload(startSource) ||
        !startMessage?.chat ||
        !startMessage.from
      ) {
        return false;
      }
      const sanityLessonId = parseCourseHomeworkStatusTelegramStart(startSource);
      if (!sanityLessonId) {
        await telegramSend('sendMessage', {
          chat_id: startMessage.chat.id,
          text: 'Не удалось открыть статус ДЗ. Вернитесь в кабинет и нажмите «Проверить статус» ещё раз.',
        });
        return true;
      }
      await ensureMember(
        admin,
        startMessage.from.id,
        memberPatch(startMessage.from, startMessage.chat.id),
      );
      try {
        const opened = await showClientCourseHomeworkLessonStatus(
          admin,
          startMessage.from.id,
          startMessage.chat.id,
          sanityLessonId,
          { forcePush: true },
        );
        if (!opened) {
          await telegramSend('sendMessage', {
            chat_id: startMessage.chat.id,
            text: 'Не удалось открыть статус ДЗ по этому вебинару.',
          });
        }
      } catch (error) {
        const text =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Не удалось открыть статус ДЗ. Попробуйте из меню «Домашние задания».';
        await telegramSend('sendMessage', { chat_id: startMessage.chat.id, text });
      }
      return true;
    }

    async function runCourseHomeworkDeepLink(): Promise<boolean> {
      if (
        startSource == null ||
        !isCourseHomeworkStartPayload(startSource) ||
        !startMessage?.chat ||
        !startMessage.from
      ) {
        return false;
      }
      const sanityLessonId = parseCourseHomeworkTelegramStart(startSource);
      if (!sanityLessonId) {
        await telegramSend('sendMessage', {
          chat_id: startMessage.chat.id,
          text: 'Не удалось открыть сдачу ДЗ. Вернитесь в кабинет и нажмите «Сдать ДЗ в Telegram» ещё раз.',
        });
        return true;
      }
      await telegramSend('sendMessage', {
        chat_id: startMessage.chat.id,
        text: 'Открываю сдачу домашнего задания…',
      });
      await ensureMember(
        admin,
        startMessage.from.id,
        memberPatch(startMessage.from, startMessage.chat.id),
      );
      try {
        await beginCourseHomeworkSubmit(
          admin,
          startMessage.from.id,
          startMessage.chat.id,
          sanityLessonId,
        );
      } catch (error) {
        const text =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Не удалось начать сдачу ДЗ. Попробуйте из меню «Домашние задания» или из кабинета на сайте.';
        await telegramSend('sendMessage', { chat_id: startMessage.chat.id, text });
      }
      return true;
    }
    if (
      startSource !== null &&
      AD_START_SOURCES.includes(startSource) &&
      update.message?.chat &&
      update.message.from
    ) {
      const adMember = await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      const adRole = resolveEffectiveRoleWithFooter(adMember, update.message.from.id).role;
      if (usesClientBotUi(adRole)) {
        await sendClientStart(admin, update.message.from.id, update.message.chat.id, {
          memberRole: adMember.role,
        });
      } else {
        await renderMainMenu(update.message.chat.id);
      }
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

    // /start hws_<lesson> | hwsb_<base64> — статус/история ДЗ из кабинета.
    if (await runCourseHomeworkStatusDeepLink()) {
      return NextResponse.json({ ok: true });
    }

    // /start hw_<lesson> | hwb_<base64> — сдача ДЗ из кабинета (до OTP и прочих /start).
    if (await runCourseHomeworkDeepLink()) {
      return NextResponse.json({ ok: true });
    }

    if (CLIENT_LESSONS_BOT_UI_ENABLED && startSource && update.message?.chat && update.message.from) {
      const { parseLeadApplyStartParam } = await import('@/lib/lead-apply-link');
      const leadApply = parseLeadApplyStartParam(startSource);
      if (leadApply) {
        const { beginClientLeadForm } = await import('@/lib/bot/client-lead-flow');
        await ensureMember(
          admin,
          update.message.from.id,
          memberPatch(update.message.from, update.message.chat.id),
        );
        await beginClientLeadForm(admin, update.message.from.id, update.message.chat.id, {
          format: leadApply.format,
          intent: leadApply.intent,
          teacherId: leadApply.teacherId,
          teacherLocked: Boolean(leadApply.teacherId),
        });
        return NextResponse.json({ ok: true });
      }
    } else if (startSource && update.message?.chat && update.message.from) {
      const { parseLeadApplyStartParam } = await import('@/lib/lead-apply-link');
      if (parseLeadApplyStartParam(startSource)) {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: CLIENT_LESSONS_BOT_DISABLED_TEXT,
        });
        return NextResponse.json({ ok: true });
      }
    }

    if (startSource && update.message?.chat && update.message.from) {
      const { parseTrialPayStart, handleTrialPayDeepLink } = await import(
        '@/lib/bot/client-trial-pay-flow'
      );
      const trialPayId = parseTrialPayStart(startSource);
      if (trialPayId) {
        await ensureMember(
          admin,
          update.message.from.id,
          memberPatch(update.message.from, update.message.chat.id),
        );
        if (CLIENT_LESSONS_BOT_UI_ENABLED) {
          await handleTrialPayDeepLink(
            admin,
            update.message.from.id,
            update.message.chat.id,
            trialPayId,
          );
        } else {
          await telegramSend('sendMessage', {
            chat_id: update.message.chat.id,
            text: CLIENT_LESSONS_BOT_DISABLED_TEXT,
          });
        }
        return NextResponse.json({ ok: true });
      }
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
      const product = options.product;
      if (product && isAccessProduct(product)) {
        const lessonProduct = product === 'individual' || product === 'group';
        if (!CLIENT_LESSONS_BOT_UI_ENABLED && lessonProduct) {
          await telegramSend('sendMessage', {
            chat_id: update.message.chat.id,
            text: CLIENT_LESSONS_BOT_DISABLED_TEXT,
          });
        } else {
          await beginStudentPurchase(admin, update.message.from.id, update.message.chat.id, options);
        }
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
      const supportTelegramId = update.message.from.id;
      await beginStudentSupport(admin, supportTelegramId, update.message.chat.id, {
        fromCabinet: true,
      });
      const { notifyAdminCabinetSupportIntent } = await import('@/lib/bot/admin/admin-dm-topic');
      await notifyAdminCabinetSupportIntent(admin, supportTelegramId).catch((err) =>
        console.error('[webhook] cabinet support admin notify failed:', err),
      );
      return NextResponse.json({ ok: true });
    }

    // /start mentor — вопрос или домашка наставнику из кабинета.
    if (startSource === 'mentor' && update.message?.chat && update.message.from) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      if (CLIENT_LESSONS_BOT_UI_ENABLED) {
        await beginStudentMentorQuestion(admin, update.message.from.id, update.message.chat.id, {
          context: 'lessons',
        });
      } else {
        await telegramSend('sendMessage', {
          chat_id: update.message.chat.id,
          text: CLIENT_LESSONS_BOT_DISABLED_TEXT,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (startSource === 'mentor_course' && update.message?.chat && update.message.from) {
      await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      await beginStudentMentorQuestion(admin, update.message.from.id, update.message.chat.id, {
        context: 'course',
      });
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

    // /start <token> — пользователь пришёл с сайта по кнопке «Подключить Telegram».
    // Не перехватываем известные deep-link префиксы (lead_/pay_/course_/… уже обработаны выше).
    if (
      startSource &&
      update.message?.text?.startsWith('/start') &&
      update.message.chat
    ) {
      const token = startSource;
      const knownDeepLink =
        token.startsWith('lead_') ||
        token.startsWith('pay_') ||
        isCourseHomeworkStartPayload(token) ||
        isCourseHomeworkStatusStartPayload(token) ||
        token.startsWith('course_') ||
        token === 'course_apply' ||
        token === 'support' ||
        token === 'mentor' ||
        token === 'mentor_course' ||
        token === 'mentor_hw' ||
        AD_START_SOURCES.includes(token);

      if (knownDeepLink) {
        if (isCourseHomeworkStatusStartPayload(token)) {
          await runCourseHomeworkStatusDeepLink();
          return NextResponse.json({ ok: true });
        }
        if (isCourseHomeworkStartPayload(token)) {
          await runCourseHomeworkDeepLink();
          return NextResponse.json({ ok: true });
        }
        if (update.message.from) {
          const member = await ensureMember(
            admin,
            update.message.from.id,
            memberPatch(update.message.from, update.message.chat.id),
          );
          const role = resolveEffectiveRoleWithFooter(member, update.message.from.id).role;
          if (usesClientBotUi(role)) {
            await sendClientStart(admin, update.message.from.id, update.message.chat.id, {
              memberRole: member.role,
            });
          } else {
            await renderMainMenu(update.message.chat.id);
          }
        }
        return NextResponse.json({ ok: true });
      }

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
          const linkedMember = await ensureMember(admin, telegramId, {
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
            await refreshClientMenu(admin, telegramId, chatId, linkedMember.role);
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
    const menuMessage = update.message;
    if (
      menuMessage?.chat &&
      menuMessage.from &&
      (menuMessage.text === '/start' ||
        isPlainBotStartCommand(menuMessage.text) ||
        menuMessage.text === '/menu' ||
        menuMessage.text === '/admin')
    ) {
      const from = menuMessage.from;
      const member = await ensureMember(
        admin,
        from.id,
        memberPatch(from, menuMessage.chat.id),
      );

      await clearBotWizardStateOnMenuStart(admin, from.id);

      const { role, testFooter } = resolveEffectiveRoleWithFooter(member, from.id);
      const testerTools = canUseTesterTools(from.id, member.role);
      const hasMask = member.viewRole && member.viewRole !== member.role;
      const creatorHint =
        member.role === 'test' && testerTools && !hasMask
          ? '\n\n🛠 /as <роль> — UI другой роли · /role me <роль> — сменить себе роль'
          : '';
      const footer = testFooter + creatorHint;
      if (isAdminEnv(from.id) && menuMessage.text === '/admin') {
        await sendAdminStart(menuMessage.chat.id, footer, admin, from.id);
      } else if (role === 'admin') {
        if (member.role === 'admin' || isAdminEnv(from.id)) {
          await sendAdminStart(menuMessage.chat.id, footer, admin, from.id);
        } else {
          await telegramSend('sendMessage', {
            chat_id: menuMessage.chat.id,
            text:
              '👋 Привет! Ты админ бота District.\n\n' +
              '/users — список участников\n' +
              '/role me <роль> — сменить свою роль\n' +
              '/role <id> <роль> — сменить роль участника\n' +
              '/id — узнать свой Telegram ID' +
              footer,
          });
        }
      } else if (await sendStaffStart(admin, menuMessage.chat.id, from.id, footer)) {
        /* combined staff menu */
      } else if (role === 'curator') {
        await sendCuratorStart(admin, menuMessage.chat.id, from.id, footer);
      } else if (role === 'teacher') {
        await sendTeacherStart(admin, menuMessage.chat.id, from.id, footer);
      } else if (usesClientBotUi(role)) {
        await sendClientStart(admin, from.id, menuMessage.chat.id, {
          testFooter: footer,
          memberRole: member.role,
        });
      } else {
        await renderMainMenu(menuMessage.chat.id, footer);
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

      if (CLIENT_LESSONS_BOT_UI_ENABLED) {
        const { handleClientLessonHomeworkAttachment } = await import(
          '@/lib/bot/client-lesson-homework-flow'
        );
        const clientLessonHwDoc = await handleClientLessonHomeworkAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          {
            fileId: update.message.document.file_id,
            kind: 'document',
            fileName: update.message.document.file_name,
          },
        );
        if (clientLessonHwDoc) return NextResponse.json({ ok: true });
      }

      const teacherDocHandled = await handleTeacherAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        {
          fileId: update.message.document.file_id,
          kind: 'document',
        },
      );
      if (teacherDocHandled) return NextResponse.json({ ok: true });

      const checkDocHandled = await handleCheckAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        'document',
        update.message.document.file_id,
      );
      if (checkDocHandled) return NextResponse.json({ ok: true });

      const curatorDocHandled = await handleCuratorAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        'document',
        update.message.document.file_id,
      );
      if (curatorDocHandled) return NextResponse.json({ ok: true });

      const { handleGuestCourseInquiryAttachment } = await import('@/lib/bot/guest-course-inquiry-flow');
      const guestCourseDocHandled = await handleGuestCourseInquiryAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? update.message.document.file_name ?? '',
        { fileId: update.message.document.file_id, kind: 'document' },
      );
      if (guestCourseDocHandled) return NextResponse.json({ ok: true });

      const staffDmDocHandled = await handleStudentStaffDmAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? update.message.document.file_name ?? '',
        { fileId: update.message.document.file_id, kind: 'document' },
      );
      if (staffDmDocHandled) return NextResponse.json({ ok: true });

      const mentorDocHandled = await handleStudentMentorAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? update.message.document.file_name ?? 'Документ',
        { fileId: update.message.document.file_id, kind: 'document' },
      );
      if (mentorDocHandled) return NextResponse.json({ ok: true });

      const supportDocHandled = await handleStudentSupportAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? '',
        {
          fileId: update.message.document.file_id,
          kind: 'document',
          fileName: update.message.document.file_name,
          mimeType: update.message.document.mime_type,
        },
      );
      if (supportDocHandled) return NextResponse.json({ ok: true });

      const leadDoc = await recordInboundClientMedia(admin, update.message.from.id, {
        messageType: 'document',
        body: update.message.caption ?? update.message.document.file_name ?? null,
        telegramMessageId: update.message.message_id,
        attachment: {
          file_id: update.message.document.file_id,
          kind: 'document',
          file_name: update.message.document.file_name,
        },
      });
      if (leadDoc) return NextResponse.json({ ok: true });

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
        update.message.caption,
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

        if (CLIENT_LESSONS_BOT_UI_ENABLED) {
          const { handleClientLessonHomeworkAttachment } = await import(
            '@/lib/bot/client-lesson-homework-flow'
          );
          const clientLessonHwPhoto = await handleClientLessonHomeworkAttachment(
            admin,
            update.message.from.id,
            update.message.chat.id,
            { fileId: largest.file_id, kind: 'photo' },
          );
          if (clientLessonHwPhoto) return NextResponse.json({ ok: true });
        }

        const checkPhotoHandled = await handleCheckAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          'photo',
          largest.file_id,
        );
        if (checkPhotoHandled) return NextResponse.json({ ok: true });

        const teacherPhotoHandled = await handleTeacherAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (teacherPhotoHandled) return NextResponse.json({ ok: true });

        const { handleGuestCourseInquiryAttachment: guestCoursePhoto } = await import(
          '@/lib/bot/guest-course-inquiry-flow'
        );
        const guestCoursePhotoHandled = await guestCoursePhoto(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? '',
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (guestCoursePhotoHandled) return NextResponse.json({ ok: true });

        const staffDmPhotoHandled = await handleStudentStaffDmAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? '',
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (staffDmPhotoHandled) return NextResponse.json({ ok: true });

        const mentorPhotoHandled = await handleStudentMentorAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? 'Photo',
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (mentorPhotoHandled) return NextResponse.json({ ok: true });

        const supportPhotoHandled = await handleStudentSupportAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.caption ?? '',
          { fileId: largest.file_id, kind: 'photo' },
        );
        if (supportPhotoHandled) return NextResponse.json({ ok: true });

        const leadPhoto = await recordInboundClientMedia(admin, update.message.from.id, {
          messageType: 'photo',
          body: update.message.caption ?? null,
          telegramMessageId: update.message.message_id,
          attachment: { file_id: largest.file_id, kind: 'photo' },
        });
        if (leadPhoto) return NextResponse.json({ ok: true });

        const handled = await handleAdminDocument(
          admin,
          update.message.from.id,
          update.message.chat.id,
          { fileId: largest.file_id, kind: 'photo' },
          update.message.caption,
        );
        if (handled) return NextResponse.json({ ok: true });
      }
    }

    if (update.message?.voice?.file_id && update.message.chat && update.message.from) {
      const checkVoiceHandled = await handleCheckAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        'voice',
        update.message.voice.file_id,
      );
      if (checkVoiceHandled) return NextResponse.json({ ok: true });

      const { handleGuestCourseInquiryAttachment: guestCourseVoice } = await import(
        '@/lib/bot/guest-course-inquiry-flow'
      );
      const guestCourseVoiceHandled = await guestCourseVoice(
        admin,
        update.message.from.id,
        update.message.chat.id,
        '',
        { fileId: update.message.voice.file_id, kind: 'voice' },
      );
      if (guestCourseVoiceHandled) return NextResponse.json({ ok: true });

      const staffDmVoiceHandled = await handleStudentStaffDmAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        '',
        { fileId: update.message.voice.file_id, kind: 'voice' },
      );
      if (staffDmVoiceHandled) return NextResponse.json({ ok: true });

      const mentorVoiceHandled = await handleStudentMentorAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        '',
        { fileId: update.message.voice.file_id, kind: 'voice' },
      );
      if (mentorVoiceHandled) return NextResponse.json({ ok: true });

      const supportVoiceHandled = await handleStudentSupportAttachment(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.caption ?? '',
        { fileId: update.message.voice.file_id, kind: 'voice', mimeType: 'audio/ogg' },
      );
      if (supportVoiceHandled) return NextResponse.json({ ok: true });

      const leadVoice = await recordInboundClientMedia(admin, update.message.from.id, {
        messageType: 'voice',
        telegramMessageId: update.message.message_id,
        attachment: { file_id: update.message.voice.file_id, kind: 'voice' },
      });
      if (leadVoice) return NextResponse.json({ ok: true });

      const { handleAdminLeadReplyMedia } = await import('@/lib/bot/admin/lead-reply-media');
      const { getState, isConversationStateTableError } = await import('@/lib/bot/admin/core');
      try {
        const state = await getState(admin, update.message.from.id);
        if (state?.step === 'admin:lead:reply') {
          const voiceHandled = await handleAdminLeadReplyMedia(admin, update.message.from.id, state, {
            fileId: update.message.voice.file_id,
            kind: 'document',
            mimeType: 'audio/ogg',
          });
          if (voiceHandled) return NextResponse.json({ ok: true });
        }
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
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
      const checkHandled =
        curatorFileId &&
        (await handleCheckAttachment(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.voice?.file_id ? 'voice' : 'photo',
          curatorFileId,
        ));
      if (checkHandled) return NextResponse.json({ ok: true });

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
    }

    // Reply Keyboard админа — до ученических и client-обработчиков.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from &&
      ADMIN_REPLY_LABEL_SET.has(update.message.text)
    ) {
      const { getStaffCourseWorkspace } = await import('@/lib/bot/staff/staff-course-session');
      const { CHECK_BOT_MENU_LABEL_SET } = await import('@/lib/bot/staff/staff-menu');
      const ws = await getStaffCourseWorkspace(admin, update.message.from.id);
      const deferToCheckStaff =
        ws?.role === 'check' && CHECK_BOT_MENU_LABEL_SET.has(update.message.text);
      if (!deferToCheckStaff) {
        const adminMenuHandled = await handleAdminMessage(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.text,
        );
        if (adminMenuHandled) return NextResponse.json({ ok: true });
      }
    }

    // Кнопки Reply Keyboard ученика: обрабатываются до контроля переписки,
    // чтобы нажатия разделов не анализировались детектором.
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const memberInfoEarly = await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      const effectiveClientRoleEarly = resolveEffectiveRoleWithFooter(
        memberInfoEarly,
        update.message.from.id,
      ).role;

      if (
        usesClientBotUi(effectiveClientRoleEarly) &&
        isClientReplyLabel(update.message.text)
      ) {
        const menuNavHandled = await handleClientReplyMenuNavigation(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.text,
          memberInfoEarly.role,
        );
        if (menuNavHandled) return NextResponse.json({ ok: true });
      }

      const hwHandled = await handleStudentHomeworkMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (hwHandled) return NextResponse.json({ ok: true });

      const { handleGuestCourseInquiryMessage } = await import('@/lib/bot/guest-course-inquiry-flow');
      const guestCourseMsgHandled = await handleGuestCourseInquiryMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (guestCourseMsgHandled) return NextResponse.json({ ok: true });

      const staffDmHandled = await handleStudentStaffDmMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (staffDmHandled) return NextResponse.json({ ok: true });

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

      const memberInfo = await ensureMember(
        admin,
        update.message.from.id,
        memberPatch(update.message.from, update.message.chat.id),
      );
      const effectiveClientRole = resolveEffectiveRoleWithFooter(
        memberInfo,
        update.message.from.id,
      ).role;

      if (usesClientBotUi(effectiveClientRole)) {
        if (CLIENT_LESSONS_BOT_UI_ENABLED) {
          const { handleClientLeadMessage } = await import('@/lib/bot/client-lead-flow');
          const leadHandled = await handleClientLeadMessage(
            admin,
            update.message.from.id,
            update.message.chat.id,
            update.message.text,
          );
          if (leadHandled) return NextResponse.json({ ok: true });
        }

        const leadInbound = await recordInboundClientMessage(
          admin,
          update.message.from.id,
          update.message.text,
          update.message.message_id,
        );
        if (leadInbound) return NextResponse.json({ ok: true });

        if (CLIENT_LESSONS_BOT_UI_ENABLED) {
          const { handleClientLessonHomeworkMessage } = await import(
            '@/lib/bot/client-lesson-homework-flow'
          );
          const lessonHwHandled = await handleClientLessonHomeworkMessage(
            admin,
            update.message.from.id,
            update.message.chat.id,
            update.message.text,
          );
          if (lessonHwHandled) return NextResponse.json({ ok: true });
        }

        const clientHandled = await handleClientMessage(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.text,
          memberInfo.role,
        );
        if (clientHandled) return NextResponse.json({ ok: true });

        const legacyHandled = await handleClientLegacyReply(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.text,
          memberInfo.role,
        );
        if (legacyHandled) return NextResponse.json({ ok: true });
      } else {
        const handled = await handleStudentMessage(
          admin,
          update.message.from.id,
          update.message.chat.id,
          update.message.text,
        );
        if (handled) return NextResponse.json({ ok: true });
      }
    }

    // Staff (teacher/curator/combined) — до catch-all админа, иначе creator/admin
    // с role|/as teacher|curator получал «Я не понял… панели».
    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const workspaceMenuHandled = await handleStaffWorkspaceMenuMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (workspaceMenuHandled) return NextResponse.json({ ok: true });

      const checkHandled = await handleCheckMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (checkHandled) return NextResponse.json({ ok: true });

      const staffGlobalHandled = await handleStaffGlobalMenuMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (staffGlobalHandled) return NextResponse.json({ ok: true });

      const combinedHandled = await handleCombinedStaffMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (combinedHandled) return NextResponse.json({ ok: true });

      const teacherHandled = await handleTeacherMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (teacherHandled) return NextResponse.json({ ok: true });

      const curatorHandled = await handleCuratorMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (curatorHandled) return NextResponse.json({ ok: true });
    }

    if (
      update.message?.text &&
      !update.message.text.startsWith('/') &&
      update.message.chat &&
      update.message.from
    ) {
      const adminTextHandled = await handleAdminMessage(
        admin,
        update.message.from.id,
        update.message.chat.id,
        update.message.text,
      );
      if (adminTextHandled) return NextResponse.json({ ok: true });
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
      const staffSkipModeration = new Set(['staff', 'teacher', 'curator', 'check', 'admin']);
      const moderateText =
        sender?.role !== 'admin' &&
        !isAdminEnv(update.message.from.id) &&
        !staffSkipModeration.has(String(sender?.role ?? 'guest'));
      if (moderateText) {
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

      const callbackData = callbackQuery.data;
      const callbackId = callbackQuery.id;
      if (callbackData && callbackId) {
        const { handleRescheduleCallback } = await import('@/lib/teacher/reschedule-callback');
        const rescheduleHandled = await handleRescheduleCallback(
          admin,
          callbackData,
          chatId,
          messageId,
          from.id,
          callbackId,
        );
        if (rescheduleHandled) return NextResponse.json({ ok: true });
      }

      const courseApplyCallbackHandled = await handleCourseApplyCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (courseApplyCallbackHandled) return NextResponse.json({ ok: true });

      const mentorPickHandled = await handleStudentMentorCallback(
        admin,
        data,
        chatId,
        from.id,
        id,
        messageId,
      );
      if (mentorPickHandled) return NextResponse.json({ ok: true });

      const purchaseHandled = await handleStudentPurchaseCallback(
        admin,
        data,
        { chatId, messageId },
        from.id,
        id,
      );
      if (purchaseHandled) return NextResponse.json({ ok: true });

      const courseHwCb = await handleCourseHomeworkCallback(admin, data, chatId, from.id, id);
      if (courseHwCb) return NextResponse.json({ ok: true });

      if (CLIENT_LESSONS_BOT_UI_ENABLED) {
        const { handleClientTrialPayCallback } = await import('@/lib/bot/client-trial-pay-flow');
        const trialPayHandled = await handleClientTrialPayCallback(admin, data, chatId, from.id);
        if (trialPayHandled) return NextResponse.json({ ok: true });
      }

      const callbackMember = await ensureMember(
        admin,
        from.id,
        memberPatch(from, chatId),
      );
      const clientCallbackHandled = await handleClientCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
        callbackMember.role,
      );
      if (clientCallbackHandled) return NextResponse.json({ ok: true });

      const effectiveCallbackRole = resolveEffectiveRoleWithFooter(
        callbackMember,
        from.id,
      ).role;
      if (usesClientBotUi(effectiveCallbackRole)) {
        const guestBridged = await bridgeGuestCallbackForClient(
          admin,
          data,
          chatId,
          messageId,
          from.id,
          id,
          callbackMember.role,
        );
        if (guestBridged) return NextResponse.json({ ok: true });
      }

      const guestHandled = await handleGuestCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (guestHandled) return NextResponse.json({ ok: true });

      const hubCbHandled = await handleStaffCourseHubCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (hubCbHandled) return NextResponse.json({ ok: true });

      const checkCbHandled = await handleCheckCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (checkCbHandled) return NextResponse.json({ ok: true });

      const combinedHandled = await handleCombinedStaffCallback(
        admin,
        data,
        chatId,
        messageId,
        from.id,
        id,
      );
      if (combinedHandled) return NextResponse.json({ ok: true });

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
      if (usesClientBotUi(effective)) {
        let inClientDialog = false;
        try {
          const dialogState = await getState(admin, update.message.from.id);
          inClientDialog = Boolean(dialogState?.step && CLIENT_DIALOG_STEPS.has(dialogState.step));
        } catch {
          inClientDialog = false;
        }
        if (!inClientDialog) {
          await handleClientUnknownText(
            admin,
            update.message.from.id,
            update.message.chat.id,
            member.role,
          );
        }
        return NextResponse.json({ ok: true });
      }
    }

  } catch (error) {
    console.error('Telegram webhook error:', error);
  }

  scheduleHomeworkDeadlineSweep(admin);

  // Telegram ждёт быстрый 200, иначе будет ретраить.
  return NextResponse.json({ ok: true });
}
