import { NextResponse } from 'next/server';
import { CourseHomeworkError } from '@/lib/bot/education/course-homework';

export function curatorJsonError(error: unknown, fallback = 'Internal error'): NextResponse {
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
