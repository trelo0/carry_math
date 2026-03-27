import { draftMode } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const redirectTo = searchParams.get('redirect') ?? '/'

  if (!process.env.SANITY_PREVIEW_SECRET) {
    return new NextResponse('Missing SANITY_PREVIEW_SECRET', { status: 500 })
  }

  if (secret !== process.env.SANITY_PREVIEW_SECRET) {
    return new NextResponse('Invalid secret', { status: 401 })
  }

  ;(await draftMode()).enable()

  return NextResponse.redirect(new URL(redirectTo, request.url))
}
