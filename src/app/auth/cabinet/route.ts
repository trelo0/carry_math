import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteLoginRedirectPath } from '@/lib/auth-login-redirect';
import { resolveCabinetLoginToken } from '@/lib/cabinet-login';
import { supabaseCookieOptions } from '@/lib/supabase/cookieOptions';

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

    const tempPassword = randomBytes(32).toString('base64url');
    const syntheticEmail = `u${phone.replace(/\D/g, '')}@auth.district.school`;
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1 });
    if (listError) throw listError;

    let userId = (listed.users ?? []).find((u) => u.email === syntheticEmail)?.id;
    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { phone },
      });
      if (createError || !created.user) throw createError ?? new Error('user not created');
      userId = created.user.id;
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: tempPassword,
      });
      if (updateError) throw updateError;
    }

    const redirectUrl = new URL(safeNext, request.url);
    let response = NextResponse.redirect(redirectUrl);
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
    return response;
  } catch (error) {
    console.error('[auth/cabinet]', error);
    return NextResponse.redirect(new URL(siteLoginRedirectPath(safeNext), request.url));
  }
}
