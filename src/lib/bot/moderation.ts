import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  getMember,
  getModerationInfo,
  listMembersInRoles,
  roleLabel,
} from '@/lib/bot/roles';

// Контроль переписки District: обнаружение попыток обмена личными
// Telegram-контактами, перехват HIGH-сообщений ДО дальнейшей обработки,
// события с ручной обработкой (предупреждение / ограничение / блокировка).
// Автоматических санкций нет — решения принимает администратор.

export type ViolationRisk = 'low' | 'medium' | 'high';
export type ViolationStatus = 'pending' | 'ignored' | 'warned' | 'restricted' | 'blocked';

export type ViolationRow = {
  id: number;
  created_at: string;
  telegram_id: number;
  chat_id: number;
  message_id: number;
  recipient_telegram_id: number | null;
  sender_role: string;
  sender_name: string | null;
  message_text: string;
  violation_type: string;
  risk_level: ViolationRisk;
  reason: string;
  status: ViolationStatus;
  action_by: number | null;
  action_at: string | null;
};

export const RISK_EMOJI: Record<ViolationRisk, string> = {
  low: '🟡',
  medium: '🟠',
  high: '🔴',
};

export const RISK_TITLE: Record<ViolationRisk, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};

export const STATUS_LABEL: Record<ViolationStatus, string> = {
  pending: '🟡 На рассмотрении',
  ignored: '✅ Игнорировано',
  warned: '⚠️ Предупреждение',
  restricted: '🚫 Ограничение',
  blocked: '🔒 Заблокировано',
};

// ---------------------------------------------------------------------------
// Детектор: только regex и ключевые шаблоны, без ИИ.
// Уровень SAFE — это отсутствие срабатываний (detectViolation вернул null).
// ---------------------------------------------------------------------------

// JS \b не работает для кириллицы, поэтому «границы слова» собираем
// lookbehind/lookahead по кириллице и латинице.
const LB = '(?<![а-яёa-z0-9_])';
const LA = '(?![а-яёa-z0-9_])';
// Варианты написания Telegram/ТГ, включая сленговые.
const TG_WORD = '(?:телеграмм|телеграм|телега|telegram|тг|tg)';

// Telegram-ссылки: t.me, telegram.me, telegram.dog — со схемой и без,
// с параметрами (?start=...), вложенными путями и якорями.
const TELEGRAM_LINK_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-z0-9_][a-z0-9_/?&=+#%.-]*/gi;

// @username. Lookbehind отбрасывает email (ivan@gmail.com) и «abc@...».
const TELEGRAM_USERNAME_REGEX = /(?<![a-z0-9_.])@[a-z][a-z0-9_]{3,31}(?![a-z0-9_])/gi;

// Простые попытки обхода: «тг: username», «мой тг username», «пиши в тг
// username» — слово Telegram/TG и рядом похожий на username латинский токен.
const TELEGRAM_BYPASS_REGEX = new RegExp(
  `${LB}${TG_WORD}\\s*[:—–-]?\\s*@?([a-z][a-z0-9_]{3,31})${LA}`,
  'gi',
);

// Токены, которые не считаются username (обычные слова после «telegram»).
const BYPASS_STOP_WORDS = new Set([
  'аккаунт',
  'аккаунта',
  'district',
  'бота',
  'канал',
  'чата',
  'группа',
  'группы',
  'группу',
  'ссылка',
  'ссылку',
]);

function findBypassContacts(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TELEGRAM_BYPASS_REGEX)) {
    const token = (match[1] ?? '').toLowerCase();
    if (!token || BYPASS_STOP_WORDS.has(token)) continue;
    // Принимаем токены с цифрами/подчёркиванием либо длинные: короткие
    // обычные слова («бот», «канал», «чат») не должны срабатывать.
    if (!/\d|_/.test(token) && token.length < 8) continue;
    found.push(token);
  }
  return found;
}

// Подозрительные фразы о переходе в личный Telegram / передаче контакта.
// Совпадение с любым шаблоном повышает риск минимум до MEDIUM.
const SUSPICIOUS_PHRASES: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: new RegExp(`${LB}(?:мой|моё|вот\\s+мой|это\\s+мой)\\s+${TG_WORD}${LA}`, 'i'),
    label: 'передача собственного Telegram',
  },
  {
    pattern: new RegExp(`${LB}${TG_WORD}\\s+(?:мой|наш|вот)${LA}`, 'i'),
    label: 'передача собственного Telegram',
  },
  {
    pattern: new RegExp(`${LB}(?:напиши(?:те)?|пиши(?:те)?|пишите)\\s[^.!?\\n]{0,40}?(?:в|на)\\s+${TG_WORD}${LA}`, 'i'),
    label: 'предложение написать в Telegram',
  },
  {
    pattern: new RegExp(`${LB}(?:свяжись|свяжитесь|связаться|связывайся|связывайтесь)[^.!?\\n]{0,40}?${TG_WORD}`, 'i'),
    label: 'предложение связаться в Telegram',
  },
  {
    pattern: new RegExp(`${LB}(?:добавь|добавьте)[^.!?\\n]{0,40}?${TG_WORD}`, 'i'),
    label: 'предложение добавить в Telegram',
  },
  {
    pattern: new RegExp(`${LB}напиши(?:те)?\\s+мне\\s+сюда${LA}`, 'i'),
    label: '«напиши мне сюда»',
  },
  {
    pattern: new RegExp(`${LB}(?:переходи|перейди|заходи(?:те)?)\\s[^.!?\\n]{0,30}?${TG_WORD}`, 'i'),
    label: 'предложение перейти в Telegram',
  },
  {
    pattern: new RegExp(`${LB}(?:увидимся|жду\\s+тебя|общаемся|созвонимся)\\s+в\\s+${TG_WORD}${LA}`, 'i'),
    label: 'предложение продолжить общение в Telegram',
  },
  {
    pattern: new RegExp(`${LB}продолж(?:им|ить|аем)[^.!?\\n]{0,30}?в\\s+${TG_WORD}${LA}`, 'i'),
    label: 'предложение продолжить общение в Telegram',
  },
  {
    pattern: new RegExp(`${LB}(?:давай(?:те)?|пойдём|перейдём|уходи(?:м|те)?)\\s+(?:в\\s+)?личк(?:у|и|е|ой)${LA}`, 'i'),
    label: 'предложение уйти в личные сообщения',
  },
  {
    pattern: new RegExp(`${LB}(?:напиши(?:те)?|пиши(?:те)?|пишите)\\s[^.!?\\n]{0,30}?в\\s+личк(?:у|е)`, 'i'),
    label: 'предложение написать в личные сообщения',
  },
  {
    pattern: new RegExp(`${LB}продолж(?:им|ить|аем)[^.!?\\n]{0,40}?(?:вне\\s+платформы|вне\\s+бота|общение\\s+вне)`, 'i'),
    label: 'предложение продолжить общение вне платформы',
  },
  {
    pattern: new RegExp(`${LB}вне\\s+платформы${LA}`, 'i'),
    label: 'упоминание общения вне платформы',
  },
];

const TELEGRAM_MENTION_REGEX = new RegExp(TG_WORD, 'i');

// Официальные каналы/группы/чаты/боты школы не нарушение: если сразу после
// слова Telegram идёт такое слово, совпадение фразы отменяется.
// «В нашем Telegram-боте есть расписание» и «заходи в наш телеграм канал»
// остаются SAFE (§3).
const OFFICIAL_TG_CONTEXT_REGEX = new RegExp(
  `${TG_WORD}[-\\s]*(?:канал|групп[ауы]|чат[ау]?|бот[ау]?)`,
  'i',
);

// Слабый контекст: рядом с упоминанием Telegram есть слова о личном
// контакте. Само по себе «У нас есть Telegram-бот District» не сработает.
const CONTACT_CONTEXT_REGEX = new RegExp(
  `${LB}(?:мой|мне|меня|напиши|пишите|пиши|свяжись|добавь|контакт|вот|сюда|переходи|заходи|ссылка|ник|аккаунт|скинь|скиньте|поделись|личк|вне)`,
  'i',
);

// ---------------------------------------------------------------------------
// Телефоны: поиск номеров в разных форматах (§1, §8).
// Точка и запятая намеренно не входят в разделители — они отсекают
// дроби, даты и перечисления, чтобы учебные числа не становились
// «номерами» (§2).
// ---------------------------------------------------------------------------

// Кандидат: необязательный «+», цифра, затем цифры/пробелы/дефисы/скобки.
// Жадный захват гарантирует, что длинная сплошная цифровая строка
// рассматривается целиком и не совпадёт частично.
const PHONE_CANDIDATE_REGEX = /\+?\d[\d\s\-()]{0,23}\d/g;

// Реалистичная структура: международный формат (11–13 цифр с «+»),
// формат с выходным префиксом 8 (11 цифр: «8 029 123 45 67», «89123456789»),
// номер оператора РБ без префикса (025/029/033/044 + 7 цифр: «029 123 45 67»).
// Прочие числа без префикса (включая 9-/10-значные) намеренно не считаются
// номерами, чтобы не зацепить учебные числа (§2).
function isRealisticPhone(digits: string, hadPlus: boolean): boolean {
  if (hadPlus) return digits.length >= 11 && digits.length <= 13;
  if (digits.length === 11 && digits.startsWith('8')) return true;
  if (/^0(25|29|33|44)\d{7}$/.test(digits)) return true;
  return false;
}

// Возвращает найденные номера в исходном оформлении — образец попадает
// в причину события и карточку администратора. Перед сопоставлением текст
// приводится к нижнему регистру (§9); исходное сообщение сохраняется
// в историю без изменений.
export function findPhoneNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.toLowerCase().matchAll(PHONE_CANDIDATE_REGEX)) {
    const sample = match[0].trim();
    const digits = sample.replace(/\D/g, '');
    if (isRealisticPhone(digits, sample.startsWith('+'))) found.push(sample);
  }
  return found;
}

// Контекст передачи номера: рядом с найденным номером уровень риска
// повышается до HIGH (§3). Отдельные общие фразы («напиши мне») сами по
// себе нарушением не считаются — только вместе с номером.
const PHONE_CONTEXT_REGEX = new RegExp(
  [
    `${LB}(?:мой|моё|вот\\s+мой|это\\s+мой)\\s+(?:номер|телефон|мобильн|контакт)`,
    `${LB}(?:звони|позвони|набери)(?:те)?\\s+мне`,
    `${LB}(?:напиши|пиши)(?:те)?\\s+(?:мне|на\\s+(?:этот|мой)\\s+номер)`,
    `${LB}свяж(?:ись|итесь)\\s+со\\s+мной`,
    `${LB}можешь\\s+(?:позвонить|написать)`,
    'whatsapp|viber|ватсап|вибер',
  ].join('|'),
  'i',
);

// Упоминание телефона/мессенджера без номера: только сохраняем (LOW).
const PHONE_PHRASE_ALONE_REGEX = new RegExp(
  [
    `${LB}(?:мой|вот\\s+мой)\\s+(?:номер|телефон|мобильн|контакт)`,
    `${LB}(?:звони|позвони)(?:те)?\\s+мне`,
    `${LB}свяж(?:ись|итесь)\\s+со\\s+мной`,
    'whatsapp|viber|ватсап|вибер',
  ].join('|'),
  'i',
);

export type ModerationDetection = {
  risk: ViolationRisk;
  type: string;
  reason: string;
};

// Роли повышенного риска: основная угроза — преподаватель/куратор,
// уводящий ученика из системы. curator и mentor — одна роль.
const HIGH_ATTENTION_ROLES = new Set(['teacher', 'curator', 'mentor']);

// Возвращает null, когда сообщение безопасно (SAFE).
export function detectViolation(text: string, senderRole?: string): ModerationDetection | null {
  const links = text.match(TELEGRAM_LINK_REGEX) ?? [];
  const usernames = text.match(TELEGRAM_USERNAME_REGEX) ?? [];
  const bypasses = findBypassContacts(text);
  const phrase = SUSPICIOUS_PHRASES.find((item) => item.pattern.test(text));
  // Упоминание официального Telegram-канала школы — не нарушение.
  const phraseMatch = phrase && !OFFICIAL_TG_CONTEXT_REGEX.test(text) ? phrase : undefined;

  const hasContact = usernames.length > 0 || links.length > 0 || bypasses.length > 0;
  const contactSample = usernames[0] ?? links[0] ?? bypasses[0];
  const contactKind = usernames.length > 0 ? 'username' : links.length > 0 ? 'link' : 'bypass';
  const isStaff = HIGH_ATTENTION_ROLES.has(senderRole ?? '');

  const phones = findPhoneNumbers(text);
  const hasPhone = phones.length > 0;
  const phoneSample = phones[0];
  const phoneContext = hasPhone && PHONE_CONTEXT_REGEX.test(text);

  // Телефон — контактные данные: HIGH при контексте передачи («мой номер…
  // позвони…», whatsapp/viber) или когда номер шлёт преподаватель/куратор
  // (§4). Номер без контекста — MEDIUM (§5).
  if (hasPhone && (phoneContext || isStaff)) {
    return {
      risk: 'high',
      type: phoneContext ? 'phone+phrase' : 'phone',
      reason: phoneContext
        ? `Телефонный номер (${phoneSample}) + призыв связаться вне платформы`
        : `Преподаватель/куратор передаёт телефонный номер: ${phoneSample}`,
    };
  }
  if (hasPhone) {
    return {
      risk: 'medium',
      type: 'phone',
      reason: `Передача телефонного номера: ${phoneSample}`,
    };
  }

  // HIGH: явная передача контакта через обходной шаблон («тг: username»,
  // «мой тг username»), контакт + приглашение, либо любая передача контакта
  // преподавателем/куратором (особый контроль, §17).
  if (bypasses.length > 0) {
    return {
      risk: 'high',
      type: 'bypass',
      reason: `Явная передача Telegram-контакта: ${bypasses[0]}`,
    };
  }
  if (hasContact && (phraseMatch || isStaff)) {
    return {
      risk: 'high',
      type: phraseMatch ? `${contactKind}+phrase` : contactKind,
      reason: phraseMatch
        ? `Telegram-контакт (${contactSample}) + ${phraseMatch.label}`
        : `Преподаватель/куратор передаёт Telegram-контакт: ${contactSample}`,
    };
  }

  // MEDIUM: контакт без приглашения либо приглашение без контакта.
  if (hasContact) {
    return {
      risk: 'medium',
      type: contactKind,
      reason: `Передача Telegram-контакта: ${contactSample}`,
    };
  }
  if (phraseMatch) {
    return {
      risk: 'medium',
      type: 'phrase',
      reason: `Подозрительная фраза: ${phraseMatch.label}`,
    };
  }

  // LOW: упоминание Telegram в контексте личного контакта без username/ссылки.
  // Официальные каналы/боты школы сюда не попадают.
  if (
    TELEGRAM_MENTION_REGEX.test(text) &&
    CONTACT_CONTEXT_REGEX.test(text) &&
    !OFFICIAL_TG_CONTEXT_REGEX.test(text)
  ) {
    return {
      risk: 'low',
      type: 'mention',
      reason: 'Упоминание Telegram в контексте личного контакта',
    };
  }

  // LOW: упоминание телефона/мессенджера для связи без самого номера —
  // только сохраняем событие.
  if (PHONE_PHRASE_ALONE_REGEX.test(text)) {
    return {
      risk: 'low',
      type: 'phone-phrase',
      reason: 'Упоминание телефона или мессенджера для связи',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Таблица bot_violations
// ---------------------------------------------------------------------------

export function isViolationTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return code === '42P01' || code === 'PGRST205' || message.includes('bot_violations');
}

// Ошибка «колонки ещё нет»: миграция bot_moderation.sql не применена.
export function isModerationColumnError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('moderation_status') ||
    message.includes('bot_violations')
  );
}

export const VIOLATIONS_PER_PAGE = 5;

export type ViolationFilter = {
  status?: ViolationStatus;
  risk?: ViolationRisk;
  telegramId?: number;
};

export async function countViolations(
  admin: SupabaseClient,
  filter: ViolationFilter,
): Promise<number> {
  let query = admin.from('bot_violations').select('id', { count: 'exact', head: true });
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.risk) query = query.eq('risk_level', filter.risk);
  if (filter.telegramId) query = query.eq('telegram_id', filter.telegramId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function listViolations(
  admin: SupabaseClient,
  filter: ViolationFilter,
  page: number,
  perPage: number = VIOLATIONS_PER_PAGE,
): Promise<{ rows: ViolationRow[]; total: number }> {
  const from = page * perPage;
  let query = admin
    .from('bot_violations')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + perPage - 1);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.risk) query = query.eq('risk_level', filter.risk);
  if (filter.telegramId) query = query.eq('telegram_id', filter.telegramId);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as ViolationRow[], total: count ?? 0 };
}

export async function getViolation(
  admin: SupabaseClient,
  id: number,
): Promise<ViolationRow | null> {
  const { data, error } = await admin.from('bot_violations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data as ViolationRow) : null;
}

// Действие администратора по событию: статус + кто и когда выполнил.
export async function reviewViolation(
  admin: SupabaseClient,
  id: number,
  status: ViolationStatus,
  adminTelegramId: number,
): Promise<void> {
  const { error } = await admin
    .from('bot_violations')
    .update({ status, action_by: adminTelegramId, action_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Счётчики пользователя считаются по истории bot_violations — данные
// постоянные и пригодны для дальнейшей аналитики (§15, §17).
export type UserViolationStats = {
  total: number;
  high: number;
  medium: number;
  low: number;
  warnings: number;
  restrictions: number;
  blocks: number;
};

export async function getUserViolationStats(
  admin: SupabaseClient,
  telegramId: number,
): Promise<UserViolationStats> {
  const { data, error } = await admin
    .from('bot_violations')
    .select('risk_level, status')
    .eq('telegram_id', telegramId)
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ risk_level: ViolationRisk; status: ViolationStatus }>;
  return {
    total: rows.length,
    high: rows.filter((row) => row.risk_level === 'high').length,
    medium: rows.filter((row) => row.risk_level === 'medium').length,
    low: rows.filter((row) => row.risk_level === 'low').length,
    warnings: rows.filter((row) => row.status === 'warned').length,
    restrictions: rows.filter((row) => row.status === 'restricted').length,
    blocks: rows.filter((row) => row.status === 'blocked').length,
  };
}

// ---------------------------------------------------------------------------
// Форматирование и служебные сообщения
// ---------------------------------------------------------------------------

function formatViolationDate(raw: string, withYear: boolean): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

export function formatViolationDateTime(raw: string): string {
  return formatViolationDate(raw, true);
}

// Короткая дата для списков: «22.08 · 16:20».
export function formatViolationDateShort(raw: string): string {
  return formatViolationDate(raw, false).replace(',', ' ·');
}

function shortenText(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function violationSenderName(row: ViolationRow): string {
  return row.sender_name?.trim() || `ID ${row.telegram_id}`;
}

// Ответ отправителю, чьё HIGH-сообщение не прошло дальше (§5).
// Без технических деталей алгоритма.
export const MESSAGE_BLOCKED_NOTICE =
  '⚠️ Сообщение не отправлено.\n\n' +
  'В нём обнаружены контактные данные или попытка перевести общение за пределы District.\n\n' +
  'Пожалуйста, продолжайте общение внутри платформы.';

// Предупреждение от администратора (§7).
function warningNotice(warningsCount: number): string {
  return (
    '⚠️ Предупреждение\n\n' +
    'Ваше сообщение нарушает правила общения District.\n\n' +
    'Не передавайте личные контакты и не переводите общение за пределы платформы.\n\n' +
    'Количество предупреждений:\n\n' +
    `${warningsCount}`
  );
}

export async function sendWarningToUser(chatId: number, warningsCount: number): Promise<void> {
  await telegramSend('sendMessage', { chat_id: chatId, text: warningNotice(warningsCount) });
}

// ---------------------------------------------------------------------------
// Принуждение: заблокированные и ограниченные пользователи (§20)
// ---------------------------------------------------------------------------

const BLOCKED_ACCESS_NOTICE =
  '🔒 Доступ к боту District приостановлен по решению администрации.\n\n' +
  'Учётная запись сохранена. Если вы считаете, что произошла ошибка, обратитесь к администрации школы.';

const RESTRICTED_ACCESS_NOTICE =
  '🚫 Возможности общения в боте District для вас ограничены.\n\n' +
  'Учётная запись сохранена. Если вы считаете, что произошла ошибка, обратитесь к администрации школы.';

// Пропускает только пользователей со статусом active (и администраторов —
// они управляют панелью). Возвращает true, если обращение остановлено.
// До применения миграции колонки нет — тогда ничего не блокируем.
export async function enforceModerationRestrictions(
  admin: SupabaseClient,
  params: {
    telegramId?: number;
    chatId?: number;
    callbackQueryId?: string;
  },
): Promise<boolean> {
  if (!params.telegramId) return false;
  try {
    const info = await getModerationInfo(admin, params.telegramId);
    if (!info || info.role === 'admin' || info.moderationStatus === 'active') return false;

    const notice =
      info.moderationStatus === 'blocked' ? BLOCKED_ACCESS_NOTICE : RESTRICTED_ACCESS_NOTICE;

    if (params.callbackQueryId) {
      await telegramSend('answerCallbackQuery', {
        callback_query_id: params.callbackQueryId,
        text: info.moderationStatus === 'blocked'
          ? '🔒 Доступ к боту приостановлен.'
          : '🚫 Возможности общения ограничены.',
        show_alert: true,
      });
    }
    if (params.chatId) {
      await telegramSend('sendMessage', { chat_id: params.chatId, text: notice });
    }
    return true;
  } catch (error) {
    if (isModerationColumnError(error)) return false;
    console.error('Контроль переписки: ошибка проверки статуса доступа:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Уведомление администраторов
// ---------------------------------------------------------------------------

async function notifyAdminsAboutViolation(
  admin: SupabaseClient,
  event: {
    id: number;
    createdAt: string;
    senderName: string;
    senderRole: string;
    text: string;
    reason: string;
    risk: ViolationRisk;
    // Что обнаружено: «Телефонный номер», «Telegram-контакт или фраза» (§6).
    detected: string;
  },
): Promise<void> {
  // Администраторы берутся из bot_members (role = 'admin'), как и в рассылках:
  // отдельный список нигде не хардкодится.
  const { members } = await listMembersInRoles(admin, ['admin'], 0, 200);
  const recipients = members.filter((member) => member.chat_id);
  if (recipients.length === 0) return;

  const text = [
    '🚨 Нарушение правил общения',
    '',
    '👤 Пользователь:',
    event.senderName,
    '',
    '🎭 Роль:',
    roleLabel(event.senderRole),
    '',
    '👥 Получатель:',
    'Бот District (личный чат)',
    '',
    '💬 Сообщение:',
    `«${shortenText(event.text, 300)}»`,
    '',
    `🔎 Причина: ${event.reason}`,
    '',
    '📱 Обнаружено:',
    event.detected,
    '',
    `${RISK_EMOJI[event.risk]} Уровень:`,
    RISK_TITLE[event.risk],
    '',
    `🕐 Время: ${formatViolationDateTime(event.createdAt)}`,
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [{ text: '👁 Подробнее', callback_data: `admin:mod:v:${event.id}:x` }],
      [
        { text: '⚠️ Предупредить', callback_data: `admin:mod:act:warn:${event.id}:x` },
        { text: '✅ Игнорировать', callback_data: `admin:mod:act:ignore:${event.id}:x` },
      ],
      [
        { text: '🚫 Ограничить', callback_data: `admin:mod:act:restrict:${event.id}:x` },
        { text: '🔒 Заблокировать', callback_data: `admin:mod:act:block:${event.id}:x` },
      ],
    ],
  };

  await Promise.all(
    recipients.map(async (member) => {
      try {
        await telegramSend('sendMessage', {
          chat_id: member.chat_id,
          text,
          reply_markup: keyboard,
        });
      } catch (error) {
        console.error(
          `Контроль переписки: уведомление не доставлено администратору ${member.telegram_id}:`,
          error,
        );
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Анализ входящего сообщения (вызывается ДО дальнейшей обработки, §1)
// ---------------------------------------------------------------------------

export type ModerationAnalysis = {
  // true — сообщение получило HIGH и не должно обрабатываться дальше.
  blocked: boolean;
};

// Точка входа из вебхука: анализирует текст НЕ-админа. Никогда не бросает
// исключения — сбой контроля не должен ломать обработку сообщения
// (в худшем случае сообщение пройдёт, а ошибка попадёт в логи).
export async function analyzeUserMessage(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    chatId: number;
    messageId: number;
    text: string;
    fallbackName?: string;
  },
): Promise<ModerationAnalysis> {
  try {
    // Роль отправителя — из bot_members; если участника ещё нет, считаем гостем.
    let senderRole = 'guest';
    let senderName: string | null = params.fallbackName ?? null;
    try {
      const member = await getMember(admin, params.telegramId);
      if (member) {
        senderRole = member.role;
        senderName = member.full_name ?? senderName;
      }
    } catch (roleError) {
      console.error('Контроль переписки: не удалось прочитать роль отправителя:', roleError);
    }

    const detection = detectViolation(params.text, senderRole);
    if (!detection) return { blocked: false };

    const { data, error } = await admin
      .from('bot_violations')
      .insert({
        telegram_id: params.telegramId,
        chat_id: params.chatId,
        message_id: params.messageId,
        recipient_telegram_id: null,
        sender_role: senderRole,
        sender_name: senderName,
        message_text: params.text.slice(0, 4000),
        violation_type: detection.type,
        risk_level: detection.risk,
        reason: detection.reason,
      })
      .select('id, created_at')
      .single();

    if (error) {
      if (isViolationTableError(error)) {
        console.error('Контроль переписки: примени миграцию supabase/bot_moderation.sql:', error);
        return { blocked: false };
      }
      throw error;
    }

    const record = data as { id: number; created_at: string } | null;
    // Что обнаружено — для карточки администратора (§6). Номер администратору
    // показываем целиком: он имеет право расследовать нарушение (§7).
    const detectedLabel = detection.type.startsWith('phone')
      ? 'Телефонный номер'
      : 'Telegram-контакт или фраза';

    // HIGH: сообщение не передаётся дальше, отправитель получает понятный
    // отказ без технических деталей (§7), администраторы — уведомление.
    if (detection.risk === 'high') {
      try {
        await telegramSend('sendMessage', { chat_id: params.chatId, text: MESSAGE_BLOCKED_NOTICE });
      } catch (noticeError) {
        console.error('Контроль переписки: не удалось отправить отказ отправителю:', noticeError);
      }
      if (record) {
        await notifyAdminsAboutViolation(admin, {
          id: record.id,
          createdAt: record.created_at,
          senderName: senderName ?? `ID ${params.telegramId}`,
          senderRole,
          text: params.text,
          reason: detection.reason,
          risk: detection.risk,
          detected: detectedLabel,
        });
      }
      return { blocked: true };
    }

    // MEDIUM-телефон: сообщение проходит, но администраторы получают
    // уведомление (§5). Telegram-MEDIUM по-прежнему только сохраняется.
    if (detection.risk === 'medium' && detection.type === 'phone' && record) {
      await notifyAdminsAboutViolation(admin, {
        id: record.id,
        createdAt: record.created_at,
        senderName: senderName ?? `ID ${params.telegramId}`,
        senderRole,
        text: params.text,
        reason: detection.reason,
        risk: detection.risk,
        detected: detectedLabel,
      });
    }

    return { blocked: false };
  } catch (error) {
    console.error('Контроль переписки: ошибка анализа сообщения:', error);
    return { blocked: false };
  }
}
