import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { type LeadRow, isLeadStatusColumnError, notifyAdminsOfNewLead } from '@/lib/bot/admin/leads';

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

    const parsed: unknown = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;

    const honeypot = normalizeString(body.website);
    if (honeypot) {
      return NextResponse.json({ success: true });
    }

    const name = normalizeString(body.name);
    const contact = normalizeString(body.contact);
    const commentRaw = body.comment;
    const teacher = normalizeString(body.teacher);
    const service = normalizeString(body.service);
    const grade = normalizeString(body.grade);
    const rating = normalizeString(body.rating);
    const rtScore = normalizeString(body.rtScore);
    const price = normalizeString(body.price);
    const waitlist = Boolean(body.waitlist);
    const spotsStatus = normalizeString(body.spotsStatus);
    const source = normalizeString(body.source);

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

    if (rating && (!/^\d{1,2}$/.test(rating) || Number(rating) < 0 || Number(rating) > 10)) {
      return NextResponse.json({ error: 'Некорректная оценка' }, { status: 400 });
    }

    if (rtScore && (!/^\d{1,3}$/.test(rtScore) || Number(rtScore) < 0 || Number(rtScore) > 100)) {
      return NextResponse.json({ error: 'Некорректный балл РТ' }, { status: 400 });
    }

    if (price.length > 120) {
      return NextResponse.json({ error: 'Слишком длинная цена' }, { status: 400 });
    }

    if (source && source !== 'consultation' && source !== 'webinar') {
      return NextResponse.json({ error: 'Некорректный источник заявки' }, { status: 400 });
    }

    if (spotsStatus && !['few', 'none', 'available'].includes(spotsStatus)) {
      return NextResponse.json({ error: 'Некорректный статус мест' }, { status: 400 });
    }

    // Основной источник данных о заявках — Supabase. Заявка считается
    // отправленной только после успешного INSERT; без записи в БД ответ 500.
    const admin = createAdminClient();
    const leadPayload = {
      name,
      contact,
      comment: comment || null,
      teacher: teacher || null,
      service: service || null,
      grade: grade || null,
      rating: rating || null,
      rt_score: rtScore || null,
      price: price || null,
      waitlist,
      spots_status: spotsStatus || null,
      source: source || null,
      ip,
    };

    let { data: leadRow, error: insertError } = await admin
      .from('leads')
      .insert({ ...leadPayload, status: 'new' })
      .select()
      .single();

    // Миграция leads_status.sql ещё не применена: сохраняем без статуса,
    // чтобы форма продолжала работать до применения миграции.
    if (insertError && isLeadStatusColumnError(insertError)) {
      const retry = await admin.from('leads').insert(leadPayload).select().single();
      leadRow = retry.data;
      insertError = retry.error;
    }

    if (insertError || !leadRow) {
      console.error('Не удалось сохранить заявку:', insertError);
      return NextResponse.json(
        { error: 'Не удалось отправить заявку. Попробуйте ещё раз.' },
        { status: 500 },
      );
    }

    // Уведомляем администраторов через существующего Telegram-бота.
    // Ошибка доставки НЕ откатывает сохранённую заявку — только логируем.
    try {
      await notifyAdminsOfNewLead(admin, leadRow as LeadRow);
    } catch (notifyError) {
      console.error('Не удалось уведомить администраторов о заявке:', notifyError);
    }

    return NextResponse.json({ success: true, id: (leadRow as LeadRow).id });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера' },
      { status: 500 }
    );
  }
}
