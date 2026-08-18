import { NextResponse } from 'next/server';

// Временная диагностика: только факт наличия переменных, без значений.
// Удалить после наладки деплоя.
export async function GET() {
  const has = (v?: string) => Boolean(v && v.trim());
  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: has(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SERVICE_ROLE_KEY: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TELEGRAM_BOT_TOKEN: has(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_CHAT_ID: has(process.env.TELEGRAM_CHAT_ID),
    TELEGRAM_WEBHOOK_SECRET: has(process.env.TELEGRAM_WEBHOOK_SECRET),
    OTP_PEPPER: has(process.env.OTP_PEPPER),
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: has(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME),
  });
}
