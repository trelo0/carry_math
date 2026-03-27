import { draftMode } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const redirectTo = searchParams.get('redirect') ?? '/'

  ;(await draftMode()).disable()

  return NextResponse.redirect(new URL(redirectTo, request.url))
}
