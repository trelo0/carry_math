type RateEntry = { count: number; resetAt: number };

declare global {
  var __authRateLimit: Map<string, RateEntry> | undefined;
}

const store: Map<string, RateEntry> =
  globalThis.__authRateLimit ?? (globalThis.__authRateLimit = new Map());

export function getIp(request: Request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true as const, retryAfterSeconds: 0 };
}
