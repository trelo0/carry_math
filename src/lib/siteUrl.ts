/** Прод-домен, если NEXT_PUBLIC_SITE_URL и VERCEL_URL не заданы. */
export const SITE_URL_FALLBACK = 'https://district-school.by';

export function getBaseUrlString() {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : SITE_URL_FALLBACK;

  return base.replace(/\/$/, '');
}

export function getMetadataBaseUrl() {
  return new URL(getBaseUrlString());
}
