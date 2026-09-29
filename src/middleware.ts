import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Если Supabase ещё не настроен (нет env-переменных) — не ломаем сайт,
  // просто пропускаем запрос без обновления сессии.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return NextResponse.next();
  }

  return createClient(request);
}

export const config = {
  matcher: [
    // Обновление сессии Supabase только там, где нужна авторизация.
    // На маркетинговых страницах (/ , /individual, …) middleware не запускается —
    // иначе каждый переход ждёт getUser() ~0.8–1.5 с.
    "/cabinet/:path*",
    "/auth/:path*",
    "/login",
    "/account",
  ],
};
