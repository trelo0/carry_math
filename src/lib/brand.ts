const BRAND_FALLBACK = 'District';

/**
 * Normalizes the CMS-provided brand name: the project was renamed
 * from "Distrikt" to "District", but old documents in Sanity may still
 * carry the previous spelling.
 */
export function normalizeBrandName(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return BRAND_FALLBACK;
  return trimmed.toLowerCase() === 'distrikt' ? BRAND_FALLBACK : trimmed;
}
