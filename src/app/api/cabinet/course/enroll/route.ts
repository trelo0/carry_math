import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureMember } from '@/lib/bot/roles';

/** Открывает карту курса в кабинете (без зачисления и без выдачи доступа). */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server config error' }, { status: 503 });
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) {
    return NextResponse.json({ error: 'Telegram not linked' }, { status: 403 });
  }

  const telegramId = link.telegram_id as number;
  const now = new Date().toISOString();

  const { error } = await admin.from('student_profiles').upsert(
    {
      telegram_id: telegramId,
      course_map_viewed_at: now,
      updated_at: now,
    },
    { onConflict: 'telegram_id' },
  );

  if (error) {
    const message = String(error.message ?? error);
    if (message.includes('course_map_viewed_at')) {
      return NextResponse.json(
        { error: 'Нужна миграция course_map_viewed.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await ensureMember(admin, telegramId, {}, 'student');
  revalidatePath('/cabinet');
  return NextResponse.json({ ok: true });
}
