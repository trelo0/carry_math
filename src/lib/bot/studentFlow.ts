import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getBaseUrlString } from '@/lib/siteUrl';
import { beginCourseHomeworkSubmit } from './studentHomeworkFlow';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import { beginStudentPurchase } from './studentPurchaseFlow';
import { beginStudentSupport } from './studentSupportFlow';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { getNextScheduledLesson } from './lessons';
import { type UserContext, getUserContext } from './accesses';
import { resolveEffectiveRole } from './roles';

// ---------------------------------------------------------------------------
// Сценарий ученика (role = student)
//
// Меню определяется не только ролью, а цепочкой:
//   роль + активные продуктовые доступы (user_accesses) → режим UI → меню.
//
// Направления:
//   • course — «КУРС»;
//   • individual и group — ОДНО направление «занятия» (отдельного
//     интерфейса для group нет).
// Если активны оба направления — показывается экран выбора направления;
// если одно — сразу его меню, без промежуточного выбора.
// Действия разделов подключены к Supabase (ДЗ, занятия, поддержка).
// UX тот же, что у админки: Reply Keyboard — навигация, ответ на ввод —
// всегда новое сообщение под текстом пользователя.
// ---------------------------------------------------------------------------

export type StudentUiMode = 'none' | 'course' | 'lessons' | 'both';

// Кнопка личного кабинета — доступна ученику всегда и в любом режиме.
export const STUDENT_HOME_LABEL = '👤 Личный кабинет';
export const STUDENT_BUY_LABEL = '💳 Купить';
// Возврат из раздела к выбору направления (только при двух направлениях).
export const STUDENT_BACK_LABEL = '⬅️ Назад';

const COURSE_DIRECTION_LABEL = '🎓 КУРС';
const LESSONS_INDIVIDUAL_LABEL = '📚 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ';
const LESSONS_MIXED_LABEL = '👥 МОИ ЗАНЯТИЯ';

const COURSE_ACTIONS = ['📚 Сдать ДЗ ментору', '🆘 Получить помощь', '📅 Ближайшее занятие'] as const;
const LESSONS_ACTIONS = ['📅 Следующее занятие', '💬 Задать вопрос наставнику', '📝 Сдать домашку'] as const;

const SUPPORT_ACTIONS = new Set(['🆘 Получить помощь', '💬 Задать вопрос наставнику']);
const HOMEWORK_ACTIONS = new Set(['📚 Сдать ДЗ ментору', '📝 Сдать домашку']);
const UPCOMING_ACTIONS = new Set(['📅 Ближайшее занятие', '📅 Следующее занятие']);

function formatUpcomingLesson(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Режим UI ученика: роль student + активные доступы → вариант меню.
export function getStudentUiMode(context: UserContext): StudentUiMode {
  const { course, individual, group } = context.accesses;
  const lessons = individual || group;
  if (course && lessons) return 'both';
  if (course) return 'course';
  if (lessons) return 'lessons';
  return 'none';
}

// Подпись направления занятий: при group (с individual или без) — короткая,
// только individual — полная.
export function getLessonsDirectionLabel(context: UserContext): string {
  return context.accesses.group ? LESSONS_MIXED_LABEL : LESSONS_INDIVIDUAL_LABEL;
}

type StudentReplyKeyboard = { keyboard: Array<Array<{ text: string }>>; resize_keyboard: boolean };

// Клавиатура раздела: каждое действие — отдельным рядом,
// затем (опционально) «Назад» и всегда — личный кабинет.
function buildSectionKeyboard(actions: readonly string[], withBack: boolean): StudentReplyKeyboard {
  const keyboard = actions.map((text) => [{ text }]);
  if (withBack) keyboard.push([{ text: STUDENT_BACK_LABEL }]);
  keyboard.push([{ text: STUDENT_BUY_LABEL }], [{ text: STUDENT_HOME_LABEL }]);
  return { keyboard, resize_keyboard: true };
}

export type StudentMainMenu = {
  mode: StudentUiMode;
  text: string;
  keyboard: StudentReplyKeyboard | null;
};

// Главное меню по режиму: единственное направление — сразу его экран,
// два направления — экран выбора, нет доступов — текст без клавиатуры.
export function buildStudentMainMenu(context: UserContext, testFooter = ''): StudentMainMenu {
  const mode = getStudentUiMode(context);
  switch (mode) {
    case 'course':
      return {
        mode,
        text: `🎓 КУРС DISTRICT${testFooter}`,
        keyboard: buildSectionKeyboard(COURSE_ACTIONS, false),
      };
    case 'lessons':
      return {
        mode,
        text: `${getLessonsDirectionLabel(context)}${testFooter}`,
        keyboard: buildSectionKeyboard(LESSONS_ACTIONS, false),
      };
    case 'both':
      return {
        mode,
        text: `🎓 Личный кабинет\n\nВыберите направление:${testFooter}`,
        keyboard: {
          keyboard: [
            [{ text: COURSE_DIRECTION_LABEL }],
            [{ text: getLessonsDirectionLabel(context) }],
            [{ text: STUDENT_BUY_LABEL }],
            [{ text: STUDENT_HOME_LABEL }],
          ],
          resize_keyboard: true,
        },
      };
    default:
      return {
        mode,
        text: `🎓 Личный кабинет\n\nУ вас пока нет активных учебных программ.${testFooter}`,
        keyboard: {
          keyboard: [[{ text: STUDENT_BUY_LABEL }], [{ text: STUDENT_HOME_LABEL }]],
          resize_keyboard: true,
        },
      };
  }
}

/** Ссылка на кабинет с одноразовым auto-login (fallback — /cabinet). */
export async function getStudentCabinetUrl(
  admin: SupabaseClient,
  telegramId: number,
  path = '/cabinet',
): Promise<string> {
  return createCabinetLoginUrl(admin, telegramId, path);
}

/** Синхронный fallback без auto-login (legacy callers). */
export function getStudentCabinetUrlSync(): string {
  return `${getBaseUrlString()}/cabinet`;
}

// ---------------------------------------------------------------------------
// Одноразовое приветствие: отправляется при ПЕРВОМ входе ученика
// с активным доступом (после подтверждения администратором), дальше — нет.
// Отметка живёт в bot_conversation_states: у реального ученика нет других
// многошаговых диалогов, тест-маскам приветствие не отмечаем, чтобы
// не затереть состояние их админ-диалогов.
// ---------------------------------------------------------------------------

const STUDENT_WELCOME_STEP = 'student:welcomed';

const STUDENT_WELCOME_TEXT =
  '🎉 Добро пожаловать в District!\n\n' +
  'Вы подтверждены как ученик школы. Ниже — ваш личный кабинет: ' +
  'выбирайте разделы кнопками под полем ввода.';

export async function isStudentWelcomed(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_conversation_states')
    .select('step')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  // Приветствие одноразовое: при сбое чтения лучше не рисковать дублем.
  if (error) return true;
  return data?.step === STUDENT_WELCOME_STEP;
}

export async function markStudentWelcomed(admin: SupabaseClient, telegramId: number, chatId: number): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').upsert(
    { telegram_id: telegramId, chat_id: chatId, message_id: 0, step: STUDENT_WELCOME_STEP, payload: {} },
    { onConflict: 'telegram_id' },
  );
  if (error) console.error('Не удалось отметить приветствие ученика:', error);
}

async function sendWithOptionalKeyboard(
  chatId: number,
  text: string,
  keyboard: StudentReplyKeyboard | null,
): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

// /start для роли student: приветствие (один раз) + главное меню по режиму.
export async function sendStudentStart(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  testFooter = '',
): Promise<void> {
  const context = await getUserContext(admin, telegramId);
  if (!context) return;

  const main = buildStudentMainMenu(context, testFooter);
  if (main.mode !== 'none' && context.role !== 'test' && !(await isStudentWelcomed(admin, telegramId))) {
    await telegramSend('sendMessage', { chat_id: chatId, text: STUDENT_WELCOME_TEXT });
    await markStudentWelcomed(admin, telegramId, chatId);
  }

  await sendWithOptionalKeyboard(chatId, main.text, main.keyboard);
}

function effectiveRole(context: UserContext): string {
  return resolveEffectiveRole(
    { role: context.role, viewRole: context.viewRole },
    context.telegramId,
  );
}

async function denyAccess(chatId: number): Promise<boolean> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: 'У вас нет активного доступа к этому разделу.',
  });
  return true;
}

// Текстовые нажатия Reply Keyboard ученика. Всё, что не является кнопкой
// меню ученика, возвращает false и обрабатывается дальше (модерация и т.д.).
export async function handleStudentMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const isDirection =
    text === COURSE_DIRECTION_LABEL ||
    text === LESSONS_INDIVIDUAL_LABEL ||
    text === LESSONS_MIXED_LABEL;
  if (
    text !== STUDENT_HOME_LABEL &&
    text !== STUDENT_BACK_LABEL &&
    text !== STUDENT_BUY_LABEL &&
    !isDirection &&
    !SUPPORT_ACTIONS.has(text) &&
    !HOMEWORK_ACTIONS.has(text) &&
    !UPCOMING_ACTIONS.has(text)
  ) {
    return false;
  }

  const context = await getUserContext(admin, telegramId);
  if (!context || effectiveRole(context) !== 'student') return false;

  const { course, individual, group } = context.accesses;
  const lessons = individual || group;

  if (text === STUDENT_BUY_LABEL) {
    await beginStudentPurchase(admin, telegramId, chatId);
    return true;
  }

  // Личный кабинет: сообщение с URL-кнопкой на кабинет сайта.
  if (text === STUDENT_HOME_LABEL) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '👤 Личный кабинет\n\nКабинет открывается на сайте District:',
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Открыть личный кабинет', url: await getStudentCabinetUrl(admin, telegramId) }]],
      },
    });
    return true;
  }

  // «Назад» — возврат к главному меню по текущему набору доступов.
  if (text === STUDENT_BACK_LABEL) {
    const main = buildStudentMainMenu(context);
    await sendWithOptionalKeyboard(chatId, main.text, main.keyboard);
    return true;
  }

  // Выбор направления (экран появляется только при двух активных направлениях).
  if (text === COURSE_DIRECTION_LABEL) {
    if (!course) return denyAccess(chatId);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '🎓 КУРС DISTRICT',
      reply_markup: buildSectionKeyboard(COURSE_ACTIONS, true),
    });
    return true;
  }
  if (text === LESSONS_INDIVIDUAL_LABEL || text === LESSONS_MIXED_LABEL) {
    if (!lessons) return denyAccess(chatId);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: getLessonsDirectionLabel(context),
      reply_markup: buildSectionKeyboard(LESSONS_ACTIONS, true),
    });
    return true;
  }

  // Действия внутри разделов; доступ перепроверяется (клавиатура могла устареть).
  const isCourseAction = (COURSE_ACTIONS as readonly string[]).includes(text);
  const isLessonsAction = (LESSONS_ACTIONS as readonly string[]).includes(text);
  if ((isCourseAction && !course) || (isLessonsAction && !lessons)) {
    return denyAccess(chatId);
  }

  if (text === '📚 Сдать ДЗ ментору') {
    return beginCourseHomeworkSubmit(admin, telegramId, chatId);
  }

  if (text === '📝 Сдать домашку') {
    await beginStudentMentorQuestion(admin, telegramId, chatId, { homework: true });
    return true;
  }

  if (text === '💬 Задать вопрос наставнику') {
    await beginStudentMentorQuestion(admin, telegramId, chatId);
    return true;
  }

  if (text === '🆘 Получить помощь') {
    await beginStudentSupport(admin, telegramId, chatId);
    return true;
  }

  if (UPCOMING_ACTIONS.has(text)) {
    const lesson = await getNextScheduledLesson(admin, telegramId);
    if (!lesson) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: '📅 Ближайших занятий пока нет.\n\nКогда администратор назначит занятие, оно появится здесь и в личном кабинете.',
      });
      return true;
    }
    const lines = [
      '📅 Ближайшее занятие',
      '',
      `📝 ${lesson.topic}`,
      `🕐 ${formatUpcomingLesson(lesson.startsAt)}`,
      `📦 ${lesson.kind === 'individual' ? 'Индивидуальное' : 'Групповое'}`,
    ];
    if (lesson.meetUrl) lines.push(`🔗 ${lesson.meetUrl}`);
    await telegramSend('sendMessage', { chat_id: chatId, text: lines.join('\n') });
    return true;
  }

  return false;
}
