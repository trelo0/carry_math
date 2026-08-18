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
    // Skip static assets, run on everything else so sessions stay fresh
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
