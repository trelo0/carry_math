import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { verifyOtpHash } from '@/lib/otp';
import { getIp, rateLimit } from '@/lib/ratelimit';

const MAX_ATTEMPTS = 5; // попыток на один код, дальше код сгорает

export async function POST(request: NextRequest) {
  const ip = getIp(request);
  const ipLimit = rateLimit(`otp-verify-ip:${ip}`, 20, 60_000);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуй позже.' },
      { status: 429, headers: { 'retry-after': String(ipLimit.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Введи 6-значный код из Telegram.' }, { status: 400 });
  }

  const phoneLimit = rateLimit(`otp-verify-phone:${phone}`, 10, 10 * 60_000);
  if (!phoneLimit.ok) {
    return NextResponse.json(
      { error: 'Слишком много попыток входа. Подожди немного.' },
      { status: 429, headers: { 'retry-after': String(phoneLimit.retryAfterSeconds) } },
    );
  }

  try {
    const admin = createAdminClient();
    const now = Date.now();

    // Кандидаты: свежие коды этого номера (использованные и сгоревшие не берём).
    const { data: rows, error: rowsError } = await admin
      .from('otp_codes')
      .select('id, code_hash, expires_at, used_at, attempts')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(5);
    if (rowsError) throw rowsError;

    const active = (rows ?? []).filter(
      (r) => !r.used_at && new Date(r.expires_at).getTime() > now && r.attempts < MAX_ATTEMPTS,
    );
    const matched = active.find((r) => verifyOtpHash(code, r.code_hash));

    if (!matched) {
      // Защищаем от перебора: считаем попытки на свежем коде.
      const fresh = active[0];
      if (fresh) {
        const attempts = (fresh.attempts ?? 0) + 1;
        await admin
          .from('otp_codes')
          .update(
            attempts >= MAX_ATTEMPTS
              ? { attempts, expires_at: new Date(now).toISOString() } // код сгорает
              : { attempts },
          )
          .eq('id', fresh.id);
        if (attempts >= MAX_ATTEMPTS) {
          return NextResponse.json(
            { error: 'Слишком много неверных попыток — код сгорел. Запроси новый.' },
            { status: 400 },
          );
        }
      }
      return NextResponse.json(
        { error: 'Неверный код. Проверь и попробуй ещё раз.' },
        { status: 400 },
      );
    }

    // Код одноразовый: помечаем использованным до выдачи сессии.
    const { error: useError } = await admin
      .from('otp_codes')
      .update({ used_at: new Date(now).toISOString() })
      .eq('id', matched.id)
      .is('used_at', null);
    if (useError) throw useError;

    // Создаём (или находим) пользователя Supabase и выдаём настоящую сессию.
    // Пароль — случайный, одноразовый, существует только на сервере.
    const tempPassword = randomBytes(32).toString('base64url');
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1 });
    if (listError) throw listError;

    let userId = (listed.users ?? []).find((u) => u.phone === phone)?.id;
    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        phone,
        password: tempPassword,
        phone_confirm: true,
      });
      if (createError || !created.user) throw createError ?? new Error('user not created');
      userId = created.user.id;
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: tempPassword,
      });
      if (updateError) throw updateError;
    }

    // Сессия через официальный API, куки пишет @supabase/ssr.
    let response = NextResponse.json({ status: 'ok' });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookies) => {
            cookies.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const { error: signInError } = await supabase.auth.signInWithPassword({
      phone,
      password: tempPassword,
    });
    if (signInError) {
      console.error('Supabase signIn error:', signInError.message);
      return NextResponse.json({ error: 'Не удалось создать сессию. Попробуй ещё раз.' }, { status: 500 });
    }

    // Связь user_id → phone → telegram_id: проставляем user_id в привязке.
    await admin.from('telegram_links').update({ user_id: userId }).eq('phone', phone);

    return response;
  } catch (error) {
    console.error('OTP verify error:', error);
    return NextResponse.json({ error: 'Ошибка сервера. Попробуй ещё раз.' }, { status: 500 });
  }
}
