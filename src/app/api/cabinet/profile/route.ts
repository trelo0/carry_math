import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const klass = typeof body.klass === 'string' ? body.klass.trim() : '';
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const resultType = body.resultType === 'ct' || body.resultType === 'grade' ? body.resultType : null;
  const resultValue =
    typeof body.resultValue === 'number' && Number.isFinite(body.resultValue) ? body.resultValue : null;

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

  const { error } = await admin.from('student_profiles').upsert(
    {
      telegram_id: link.telegram_id,
      display_name: name || null,
      school_class: klass || null,
      goal: goal || null,
      result_type: resultType,
      result_value: resultValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
