import { NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;

type RateEntry = { count: number; resetAt: number };

declare global {
  var __submitRateLimit: Map<string, RateEntry> | undefined;
}

const rateLimitStore: Map<string, RateEntry> =
  globalThis.__submitRateLimit ?? (globalThis.__submitRateLimit = new Map());

function getIp(request: Request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function rateLimit(key: string) {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true as const, retryAfterSeconds: 0 };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { ok: false as const, retryAfterSeconds };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { ok: true as const, retryAfterSeconds: 0 };
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const limit = rateLimit(`ip:${ip}`);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        {
          status: 429,
          headers: {
            'retry-after': String(limit.retryAfterSeconds),
          },
        },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    }

    const honeypot = normalizeString((body as any).website);
    if (honeypot) {
      return NextResponse.json({ success: true });
    }

    const name = normalizeString((body as any).name);
    const contact = normalizeString((body as any).contact);
    const commentRaw = (body as any).comment;
    const teacher = normalizeString((body as any).teacher);
    const service = normalizeString((body as any).service);
    const grade = normalizeString((body as any).grade);
    const rating = normalizeString((body as any).rating);
    const rtScore = normalizeString((body as any).rtScore);
    const price = normalizeString((body as any).price);
    const waitlist = Boolean((body as any).waitlist);
    const spotsStatus = normalizeString((body as any).spotsStatus);
    const source = normalizeString((body as any).source);

    const comment = typeof commentRaw === 'string' ? commentRaw.trim() : '';

    // Валидация
    if (!name || !contact) {
      return NextResponse.json(
        { error: 'Имя и контакт обязательны' },
        { status: 400 }
      );
    }

    if (name.length > 80) {
      return NextResponse.json({ error: 'Слишком длинное имя' }, { status: 400 });
    }

    if (contact.length > 120) {
      return NextResponse.json({ error: 'Слишком длинный контакт' }, { status: 400 });
    }

    if (comment.length > 1000) {
      return NextResponse.json({ error: 'Слишком длинный комментарий' }, { status: 400 });
    }

    if (grade && (!/^\d{1,2}$/.test(grade) || Number(grade) < 1 || Number(grade) > 12)) {
      return NextResponse.json({ error: 'Некорректный класс' }, { status: 400 });
    }

    if (rating && (!/^\d{1,2}$/.test(rating) || Number(rating) < 1 || Number(rating) > 10)) {
      return NextResponse.json({ error: 'Некорректная оценка' }, { status: 400 });
    }

    if (rtScore && (!/^\d{1,3}$/.test(rtScore) || Number(rtScore) < 0 || Number(rtScore) > 100)) {
      return NextResponse.json({ error: 'Некорректный балл РТ' }, { status: 400 });
    }

    if (price.length > 120) {
      return NextResponse.json({ error: 'Слишком длинная цена' }, { status: 400 });
    }

    if (source && source !== 'consultation') {
      return NextResponse.json({ error: 'Некорректный источник заявки' }, { status: 400 });
    }

    if (spotsStatus && !['few', 'none', 'available'].includes(spotsStatus)) {
      return NextResponse.json({ error: 'Некорректный статус мест' }, { status: 400 });
    }

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return NextResponse.json(
        { error: 'Сервис заявок временно недоступен' },
        { status: 500 },
      );
    }

    // Формируем сообщение
    let message = `🎓 *Новая заявка*\n\n`;
    
    // Если заявка из формы консультации
    if (source === 'consultation') {
      message += `📞 *Консультация*\n\n`;
    }
    
    message += `👤 *Имя:* ${name}\n`;
    message += `📞 *Контакт:* ${contact}\n`;
    
    if (teacher) {
      message += `👨‍🏫 *Преподаватель:* ${teacher}\n`;
    }
    if (service) {
      message += `📚 *Услуга:* ${service}\n`;
    }
    if (grade) {
      message += `🏫 *Класс:* ${grade}\n`;
    }
    if (rating) {
      message += `📈 *Оценка:* ${rating}\n`;
    }
    if (rtScore) {
      message += `🎯 *Балл РТ:* ${rtScore}\n`;
    }
    if (price) {
      message += `💳 *Цена:* ${price}\n`;
    }
    if (spotsStatus) {
      if (spotsStatus === 'few') {
        message += `🔥 *Статус мест:* Мало мест\n`;
      } else if (spotsStatus === 'none') {
        message += `⏳ *Статус мест:* Мест нет\n`;
      } else {
        message += `✅ *Статус мест:* Есть места\n`;
      }
    }
    if (waitlist) {
      message += `📝 *Тип записи:* Предварительная\n`;
    }
    if (comment) {
      message += `💬 *Комментарий:* ${comment}\n`;
    }
    
    message += `\n📅 *Дата:* ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;

    // Отправляем в Telegram
    const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const telegramData = await response.json();

    if (!telegramData.ok) {
      console.error('Telegram error:', telegramData);
      return NextResponse.json(
        { error: 'Ошибка отправки в Telegram' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера' },
      { status: 500 }
    );
  }
}
