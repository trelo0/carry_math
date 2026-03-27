import { revalidateTag as nextRevalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

const revalidateTag = nextRevalidateTag as any

export async function POST(request: Request) {
  const secret = request.headers.get('x-revalidate-secret')

  if (!process.env.SANITY_REVALIDATE_SECRET) {
    return new NextResponse('Missing SANITY_REVALIDATE_SECRET', { status: 500 })
  }

  if (secret !== process.env.SANITY_REVALIDATE_SECRET) {
    return new NextResponse('Invalid secret', { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const docType = payload?._type as string | undefined

  // If Sanity cannot determine the type, fall back to a broad revalidate.
  if (!docType) {
    revalidateTag('sanity:siteSettings')
    revalidateTag('sanity:homePage')
    revalidateTag('sanity:teacher')
    revalidateTag('sanity:course')
    revalidateTag('sanity:problem')
    revalidateTag('sanity:methodStep')
    revalidateTag('sanity:processStep')

    return NextResponse.json({ revalidated: true, tags: 'all' })
  }

  const tag = `sanity:${docType}`
  revalidateTag(tag)

  return NextResponse.json({ revalidated: true, tag })
}
