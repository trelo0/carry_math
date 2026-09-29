// src/lib/studio/sanityImage.ts
import imageUrlBuilder from '@sanity/image-url';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';

const builder = imageUrlBuilder({ projectId, dataset });

export function urlFor(source: Parameters<typeof builder.image>[0]) {
  return builder.image(source);
}

export function buildImageUrl(
  source: unknown,
  opts?: { width?: number; height?: number },
): string | null {
  if (!source) return null;
  if (typeof source === 'string') return source;

  let img = builder.image(source as Parameters<typeof builder.image>[0]);
  if (opts?.width) img = img.width(opts.width);
  if (opts?.height) img = img.height(opts.height);
  return img.url();
}
