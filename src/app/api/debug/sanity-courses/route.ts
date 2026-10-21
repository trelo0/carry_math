import { NextResponse } from 'next/server';
import { listDistrictCourseSummaries } from '@/lib/studio/courseContent';

/** Сколько districtCourse видит сервер (без секретов). Удалить после деплоя. */
export async function GET() {
  try {
    const summaries = await listDistrictCourseSummaries();
    return NextResponse.json({
      ok: true,
      count: summaries.length,
      slugs: summaries.map((s) => s.slug),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
