import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { generateOtp, hashOtp, newToken } from '@/lib/otp';
import { sendOtpMessage } from '@/lib/telegram';
import { getIp, rateLimit } from '@/lib/ratelimit';

const OTP_TTL_MS = 5 * 60_000; // код живёт 5 минут
const RESEND_COOLDOWN_MS = 60_000; // повторная отправка не чаще раза в минуту
const TOKEN_TTL_MS = 10 * 60_000; // токен привязки живёт 10 минут

export async function POST(request: Request) {
  const ip = getIp(request);
  const ipLimit = rateLimit(`otp-req-ip:${ip}`, 10, 60_000);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуй позже.' },
      { status: 429, headers: { 'retry-after': String(ipLimit.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  if (!phone) {
    return NextResponse.json(
      { error: 'Формат номера: +375 29 123-45-67' },
      { status: 400 },
    );
  }

  const phoneLimit = rateLimit(`otp-req-phone:${phone}`, 5, 10 * 60_000);
  if (!phoneLimit.ok) {
    return NextResponse.json(
      { error: 'Слишком много попыток. Подожди немного и попробуй ещё раз.' },
      { status: 429, headers: { 'retry-after': String(phoneLimit.retryAfterSeconds) } },
    );
  }

  try {
    const admin = createAdminClient();

    // Привязан ли Telegram к этому номеру? Ищем только в таблице привязок —
    // никакого поиска telegram_id по номеру в обход бота.
    const { data: link, error: linkError } = await admin
      .from('telegram_links')
      .select('phone, telegram_id')
      .eq('phone', phone)
      .maybeSingle();
    if (linkError) throw linkError;

    if (!link) {
      // Токен одноразовый: именно он доказывает, что владелец Telegram
      // запустил бота и нажал «Подключить аккаунт».
      const token = newToken();
      const { error: tokenError } = await admin.from('telegram_link_tokens').insert({
        phone,
        token,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      });
      if (tokenError) throw tokenError;

      const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
      if (!username) throw new Error('NEXT_PUBLIC_TELEGRAM_BOT_USERNAME не настроен');

      return NextResponse.json({
        status: 'not_linked',
        connectUrl: `https://t.me/${username}?start=${token}`,
      });
    }

    // Кулдаун повторной отправки.
    const { data: last } = await admin
      .from('otp_codes')
      .select('last_sent_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) {
      const waitMs =
        RESEND_COOLDOWN_MS - (Date.now() - new Date(last.last_sent_at).getTime());
      if (waitMs > 0) {
        const seconds = Math.ceil(waitMs / 1000);
        return NextResponse.json(
          { error: `Код уже отправлен. Повторно — через ${seconds} сек.` },
          { status: 429, headers: { 'retry-after': String(seconds) } },
        );
      }
    }

    const code = generateOtp();
    const { error: otpError } = await admin.from('otp_codes').insert({
      phone,
      code_hash: hashOtp(code),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    });
    if (otpError) throw otpError;

    const sent = await sendOtpMessage(Number(link.telegram_id), code);
    if (!sent.ok) {
      console.error('Telegram OTP send error:', sent.description);
      return NextResponse.json(
        { error: 'Не удалось отправить код в Telegram. Попробуй ещё раз.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    console.error('OTP request error:', error);
    return NextResponse.json({ error: 'Ошибка сервера. Попробуй ещё раз.' }, { status: 500 });
  }
}
