// src/lib/sanityClient.ts
import { createClient } from 'next-sanity'

type SanityClientOptions = {
  preview?: boolean
}

export function getSanityClient({ preview }: SanityClientOptions = {}) {
  const isPreview = Boolean(preview)
  const isDev = process.env.NODE_ENV !== 'production'

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
    useCdn: !isPreview && !isDev,
    token: isPreview ? process.env.SANITY_API_READ_TOKEN : undefined,
    perspective: isPreview ? 'previewDrafts' : 'published',
  })
}