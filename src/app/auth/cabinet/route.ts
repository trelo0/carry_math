import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteLoginRedirectPath } from '@/lib/auth-login-redirect';
import { resolveCabinetLoginToken } from '@/lib/cabinet-login';
import { preparePhoneAuthSignIn } from '@/lib/auth-user-by-phone';
import { supabaseCookieOptions } from '@/lib/supabase/cookieOptions';
import { handleCabinetAuthActivity } from '@/lib/bot/admin/user-activity-events';
import { createHash } from 'crypto';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  const nextPath = request.nextUrl.searchParams.get('next')?.trim() || '/cabinet';
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/cabinet';

  if (!token) {
    return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
  }

  try {
    const admin = createAdminClient();
    const telegramId = await resolveCabinetLoginToken(admin, token);
    if (!telegramId) {
      return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
    }

    const { data: link } = await admin
      .from('telegram_links')
      .select('phone')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    const phone = link?.phone;
    if (!phone) {
      return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
    }

    const { userId, syntheticEmail, tempPassword } = await preparePhoneAuthSignIn(admin, phone);

    const redirectUrl = new URL(safeNext, request.url);
    const response = NextResponse.redirect(redirectUrl);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookieOptions: supabaseCookieOptions,
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
      email: syntheticEmail,
      password: tempPassword,
    });
    if (signInError) {
      return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
    }

    await admin.from('telegram_links').update({ user_id: userId }).eq('phone', phone);

    const tokenRef = createHash('sha256').update(token).digest('hex').slice(0, 32);
    void handleCabinetAuthActivity(admin, {
      userId,
      phone,
      authDedupeRef: `magic:${tokenRef}`,
    }).catch((err) => console.error('[auth/cabinet] auth activity notify failed:', err));

    return response;
  } catch (error) {
    console.error('[auth/cabinet]', error);
    return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
  }
}
