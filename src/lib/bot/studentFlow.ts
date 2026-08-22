import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getBaseUrlString } from '@/lib/siteUrl';
import { type UserContext, getUserContext } from './accesses';

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
// Учебной системы пока нет: все действия — заглушки без фиктивных данных.
// UX тот же, что у админки: Reply Keyboard — навигация, ответ на ввод —
// всегда новое сообщение под текстом пользователя.
// ---------------------------------------------------------------------------

export type StudentUiMode = 'none' | 'course' | 'lessons' | 'both';

// Кнопка личного кабинета — доступна ученику всегда и в любом режиме.
export const STUDENT_HOME_LABEL = '👤 Личный кабинет';
// Возврат из раздела к выбору направления (только при двух направлениях).
export const STUDENT_BACK_LABEL = '⬅️ Назад';

const COURSE_DIRECTION_LABEL = '🎓 КУРС';
const LESSONS_INDIVIDUAL_LABEL = '📚 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ';
const LESSONS_MIXED_LABEL = '👥 МОИ ЗАНЯТИЯ';

const COURSE_ACTIONS = ['📚 Сдать ДЗ ментору', '🆘 Получить помощь', '📅 Ближайшее занятие'] as const;
const LESSONS_ACTIONS = ['📅 Следующее занятие', '💬 Задать вопрос наставнику', '📝 Сдать домашку'] as const;

// Заглушки действий: реальных занятий/домашек/сообщений пока нет,
// фиктивные данные не показываем.
const ACTION_STUBS: Record<string, string> = {
  '📚 Сдать ДЗ ментору': 'Раздел сдачи домашних заданий находится в разработке.',
  '🆘 Получить помощь': 'Раздел помощи находится в разработке.',
  '📅 Ближайшее занятие': 'Раздел занятий находится в разработке.',
  '📅 Следующее занятие': 'Раздел занятий находится в разработке.',
  '💬 Задать вопрос наставнику': 'Раздел сообщений находится в разработке.',
  '📝 Сдать домашку': 'Раздел сдачи домашних заданий находится в разработке.',
};

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
  keyboard.push([{ text: STUDENT_HOME_LABEL }]);
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
            [{ text: STUDENT_HOME_LABEL }],
          ],
          resize_keyboard: true,
        },
      };
    default:
      return {
        mode,
        text: `🎓 Личный кабинет\n\nУ вас пока нет активных учебных программ.${testFooter}`,
        keyboard: null,
      };
  }
}

// Ссылка на личный кабинет сайта. Страница кабинета — /account
// (вход по OTP через телефон уже существует). Когда появится авто-вход
// по привязке Telegram, токен/deep-link добавится здесь, не меняя меню.
export function getStudentCabinetUrl(): string {
  return `${getBaseUrlString()}/account`;
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

// Эффективная роль с учётом тест-маски: тестер с /as student видит ученика.
function effectiveRole(context: UserContext): string {
  if (context.role === 'test' && context.viewRole && context.viewRole !== 'test') {
    return context.viewRole;
  }
  return context.role;
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
    !isDirection &&
    !(text in ACTION_STUBS)
  ) {
    return false;
  }

  const context = await getUserContext(admin, telegramId);
  if (!context || effectiveRole(context) !== 'student') return false;

  const { course, individual, group } = context.accesses;
  const lessons = individual || group;

  // Личный кабинет: сообщение с URL-кнопкой на кабинет сайта.
  if (text === STUDENT_HOME_LABEL) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '👤 Личный кабинет\n\nКабинет открывается на сайте District:',
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Открыть личный кабинет', url: getStudentCabinetUrl() }]],
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

  // Действия внутри разделов — заглушки; доступ перепроверяется
  // (клавиатура могла остаться от старого набора доступов).
  const isCourseAction = (COURSE_ACTIONS as readonly string[]).includes(text);
  if ((isCourseAction && !course) || (!isCourseAction && !lessons)) {
    return denyAccess(chatId);
  }
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: `${text}\n\n${ACTION_STUBS[text]}`,
  });
  return true;
}
