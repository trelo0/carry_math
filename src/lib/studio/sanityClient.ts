// src/lib/studio/sanityClient.ts
import { createClient } from 'next-sanity'

type SanityClientOptions = {
  preview?: boolean
  /** Читать черновики Sanity (нужен SANITY_API_READ_TOKEN на сервере). */
  includeDrafts?: boolean
}

export function getSanityClient({ preview, includeDrafts }: SanityClientOptions = {}) {
  const isPreview = Boolean(preview)
  const isDev = process.env.NODE_ENV !== 'production'
  const readToken = process.env.SANITY_API_READ_TOKEN ?? process.env.SANITY_API_WRITE_TOKEN
  const isServer = typeof window === 'undefined'
  const useDrafts = Boolean(isPreview || includeDrafts || (isServer && readToken))

  const envProjectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const envDataset = process.env.NEXT_PUBLIC_SANITY_DATASET

  const usingLegacyDefaults = !envProjectId && !envDataset
  if (!usingLegacyDefaults && (!envProjectId || !envDataset)) {
    throw new Error(
      'Sanity is misconfigured. Please set BOTH NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET (or neither to use legacy defaults).',
    )
  }

  const projectId = envProjectId ?? '2hngrocd'
  const dataset = envDataset ?? 'production'
  const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? '2023-03-17'

  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: !useDrafts && !isDev,
    token: useDrafts ? readToken : undefined,
    perspective: isPreview ? 'previewDrafts' : useDrafts ? 'raw' : 'published',
  })
}
