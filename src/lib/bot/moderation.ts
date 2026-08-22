import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getMember, listMembersInRoles, roleLabel } from '@/lib/bot/roles';

// Контроль переписки, первая версия: только обнаружение попыток обмена
// личными Telegram-контактами, сохранение события и уведомление
// администраторов. Никаких автоматических блокировок.

export type ViolationRisk = 'low' | 'medium' | 'high';
export type ViolationStatus = 'pending' | 'ignored' | 'blocked';

export type ViolationRow = {
  id: number;
  created_at: string;
  telegram_id: number;
  chat_id: number;
  message_id: number;
  sender_role: string;
  sender_name: string | null;
  message_text: string;
  violation_type: string;
  risk_level: ViolationRisk;
  reason: string;
  status: ViolationStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
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
  ignored: '🟢 Проигнорировано',
  blocked: '🔴 Нарушение подтверждено',
};

// ---------------------------------------------------------------------------
// Детектор: только regex и ключевые шаблоны, без ИИ.
// ---------------------------------------------------------------------------

// JS \b не работает для кириллицы, поэтому «границы слова» собираем
// lookbehind/lookahead по кириллице и латинице.
const LB = '(?<![а-яёa-z0-9_])';
const LA = '(?![а-яёa-z0-9_])';
// Варианты написания Telegram/ТГ.
const TG_WORD = '(?:телеграмм|телеграм|telegram|тг|tg)';

// Telegram-ссылки: t.me, telegram.me, telegram.dog — со схемой и без,
// с параметрами (?start=...), вложенными путями и якорями.
const TELEGRAM_LINK_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-z0-9_][a-z0-9_/?&=+#%.-]*/gi;

// @username. Lookbehind отбрасывает email (ivan@gmail.com) и «abc@...».
const TELEGRAM_USERNAME_REGEX = /(?<![a-z0-9_.])@[a-z][a-z0-9_]{3,31}(?![a-z0-9_])/gi;

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
    pattern: new RegExp(`${LB}(?:увидимся|жду\\s+тебя|общаемся|продолжим|созвонимся)\\s+в\\s+${TG_WORD}`, 'i'),
    label: 'предложение продолжить общение в Telegram',
  },
];

const TELEGRAM_MENTION_REGEX = new RegExp(TG_WORD, 'i');

// Слабый контекст: рядом с упоминанием Telegram есть слова о личном
// контакте. Само по себе «У нас есть Telegram-бот District» не сработает.
const CONTACT_CONTEXT_REGEX = new RegExp(
  `${LB}(?:мой|мне|меня|напиши|пишите|пиши|свяжись|добавь|контакт|вот|сюда|переходи|заходи|ссылка|ник|аккаунт|скинь|скиньте|поделись)`,
  'i',
);

export type ModerationDetection = {
  risk: ViolationRisk;
  type: string;
  reason: string;
};

// Возвращает null, когда сообщение не похоже на попытку обмена контактами.
export function detectViolation(text: string): ModerationDetection | null {
  const links = text.match(TELEGRAM_LINK_REGEX) ?? [];
  const usernames = text.match(TELEGRAM_USERNAME_REGEX) ?? [];
  const phrase = SUSPICIOUS_PHRASES.find((item) => item.pattern.test(text));

  const hasContact = usernames.length > 0 || links.length > 0;
  const contactSample = usernames[0] ?? links[0];
  const contactKind = usernames.length > 0 ? 'username' : 'link';

  // HIGH: явная передача username/ссылки вместе с предложением связаться.
  if (hasContact && phrase) {
    return {
      risk: 'high',
      type: `${contactKind}+phrase`,
      reason: `Telegram-контакт (${contactSample}) + ${phrase.label}`,
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
  if (phrase) {
    return {
      risk: 'medium',
      type: 'phrase',
      reason: `Подозрительная фраза: ${phrase.label}`,
    };
  }

  // LOW: упоминание Telegram в контексте личного контакта без username/ссылки.
  if (TELEGRAM_MENTION_REGEX.test(text) && CONTACT_CONTEXT_REGEX.test(text)) {
    return {
      risk: 'low',
      type: 'mention',
      reason: 'Упоминание Telegram в контексте личного контакта',
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

// Обработка события администратором: смена статуса + кто и когда обработал.
export async function reviewViolation(
  admin: SupabaseClient,
  id: number,
  status: ViolationStatus,
  reviewerId: number,
): Promise<void> {
  const { error } = await admin
    .from('bot_violations')
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Анализ входящего сообщения и уведомление администраторов
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

async function notifyAdminsAboutViolation(
  admin: SupabaseClient,
  event: {
    id: number;
    createdAt: string;
    senderName: string;
    senderRole: string;
    text: string;
    reason: string;
  },
): Promise<void> {
  // Администраторы берутся из bot_members (role = 'admin'), как и в рассылках:
  // отдельный список нигде не хардкодится.
  const { members } = await listMembersInRoles(admin, ['admin'], 0, 200);
  const recipients = members.filter((member) => member.chat_id);
  if (recipients.length === 0) return;

  const text = [
    '🚨 Подозрительная активность',
    '',
    `👤 ${event.senderName}`,
    `🎭 ${roleLabel(event.senderRole)}`,
    '',
    '👥 Получатель:',
    'Бот District (личный чат)',
    '',
    '💬 Сообщение:',
    '',
    `«${shortenText(event.text, 300)}»`,
    '',
    `🔎 Причина: ${event.reason}`,
    '🔴 Уровень: HIGH',
    '',
    `🕐 ${formatViolationDateTime(event.createdAt)}`,
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [{ text: '👁 Открыть', callback_data: `admin:mod:v:${event.id}:x` }],
      [
        { text: '⚠️ Заблокировать', callback_data: `admin:mod:act:block:${event.id}:x` },
        { text: '✅ Игнорировать', callback_data: `admin:mod:act:ignore:${event.id}:x` },
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

// Точка входа из вебхука: анализирует текст НЕ-админа. Никогда не бросает
// исключения — наблюдение не должно ломать обработку сообщения.
export async function analyzeUserMessage(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    chatId: number;
    messageId: number;
    text: string;
    fallbackName?: string;
  },
): Promise<void> {
  try {
    const detection = detectViolation(params.text);
    if (!detection) return;

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

    const { data, error } = await admin
      .from('bot_violations')
      .insert({
        telegram_id: params.telegramId,
        chat_id: params.chatId,
        message_id: params.messageId,
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
        console.error('Контроль переписки: примени миграцию supabase/bot_violations.sql:', error);
        return;
      }
      throw error;
    }

    const record = data as { id: number; created_at: string } | null;
    if (detection.risk === 'high' && record) {
      await notifyAdminsAboutViolation(admin, {
        id: record.id,
        createdAt: record.created_at,
        senderName: senderName ?? `ID ${params.telegramId}`,
        senderRole,
        text: params.text,
        reason: detection.reason,
      });
    }
  } catch (error) {
    console.error('Контроль переписки: ошибка анализа сообщения:', error);
  }
}
