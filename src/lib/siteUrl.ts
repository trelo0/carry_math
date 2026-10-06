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

/** Публичные ссылки бота и кабинета — всегда основной домен, не preview vercel.app. */
export function getPublicSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return SITE_URL_FALLBACK;
}

export function getMetadataBaseUrl() {
  return new URL(getBaseUrlString());
}
