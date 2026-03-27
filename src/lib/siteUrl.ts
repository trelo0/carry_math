export function getBaseUrlString() {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  return base.replace(/\/$/, "");
}

export function getMetadataBaseUrl() {
  return new URL(getBaseUrlString());
}
