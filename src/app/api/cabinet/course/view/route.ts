import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCabinetCourseViewSlice } from '@/lib/cabinet';

/** Быстрый срез курса для переключателя в кабинете (без полной перезагрузки). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  const slug = new URL(request.url).searchParams.get('course')?.trim() ?? '';
  if (!slug) {
    return NextResponse.json({ error: 'course required' }, { status: 400 });
  }

  try {
    const slice = await getCabinetCourseViewSlice(phone, slug);
    if (!slice) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json(slice);
  } catch (error) {
    console.error('[cabinet/course/view]', error);
    return NextResponse.json({ error: 'Failed to load course' }, { status: 500 });
  }
}
