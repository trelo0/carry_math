import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { PEOPLE_TAG } from '@/lib/admin/people-data';
import { isAssignableRole, type AssignableRole } from '@/lib/admin/people-roles';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { combineMemberRoles, isCreatorTelegramId, setMemberExtraRoles, setRole, type BotRole } from '@/lib/bot/roles';

export const dynamic = 'force-dynamic';

type Body = { telegramId?: number; primary?: string; extra?: string[] };

/** PUT { telegramId, primary, extra[] } — сменить основную и дополнительные роли. */
export async function PUT(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  const telegramId = Number(body.telegramId);
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return NextResponse.json({ error: 'Не указан пользователь' }, { status: 400 });
  }
  if (!isAssignableRole(body.primary)) {
    return NextResponse.json({ error: 'Недопустимая основная роль' }, { status: 400 });
  }
  const primary: AssignableRole = body.primary;
  const extra = [...new Set((body.extra ?? []).filter(isAssignableRole))].filter((r) => r !== primary);

  const admin = auth.admin;
  const { data: member, error } = await admin
    .from('bot_members')
    .select('role, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!member) return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });

  const before = combineMemberRoles(String(member.role ?? 'guest'), member.extra_roles as string[] | null);
  const after: BotRole[] = [primary, ...extra];

  // Админ-доступ нельзя снять у самого себя и у создателя (ADMIN_TELEGRAM_IDS).
  const losesAdmin = before.includes('admin') && !after.includes('admin');
  if (losesAdmin && (telegramId === auth.telegramId || isCreatorTelegramId(telegramId))) {
    return NextResponse.json(
      { error: 'Нельзя снять роль admin у себя или у владельца системы.' },
      { status: 409 },
    );
  }

  try {
    await setRole(admin, telegramId, primary);
    await setMemberExtraRoles(admin, telegramId, extra);
    await logAdminAction(admin, {
      actorTelegramId: auth.telegramId,
      action: 'user.role',
      entityType: 'user',
      entityId: telegramId,
      targetTelegramId: telegramId,
      detail: { before, after },
    });
    revalidateTag(PEOPLE_TAG, { expire: 0 });
    revalidateTag('admin-staff-candidates', { expire: 0 });
    revalidateTag('admin-panel-auth', { expire: 0 });
    return NextResponse.json({ ok: true, primary, extra });
  } catch (e) {
    console.error('[admin people roles]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка' }, { status: 500 });
  }
}
