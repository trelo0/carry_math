import { NextResponse } from 'next/server';
import { CourseHomeworkError } from '@/lib/bot/education/course-homework';
import { StaffCourseAccessError } from '@/lib/curator/staff-course-access';

export function curatorJsonError(error: unknown, fallback = 'Internal error'): NextResponse {
  if (error instanceof StaffCourseAccessError) {
    const status = error.code === 'NOT_FOUND' ? 404 : 403;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof CourseHomeworkError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes('SANITY_API_WRITE_TOKEN')) {
    return NextResponse.json({ error: 'Sanity write token не настроен на сервере.' }, { status: 503 });
  }
  console.error('[curator-api]', error);
  return NextResponse.json({ error: message || fallback }, { status: 500 });
}
