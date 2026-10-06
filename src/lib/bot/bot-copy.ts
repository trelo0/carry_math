import { groq } from 'next-sanity';
import { getSanityClient } from '@/lib/studio/sanityClient';
import {
  BOT_COPY_KEYS,
  DEFAULT_BOT_COPY,
  type BotCopyKey,
} from './bot-copy-defaults';

export { BOT_COPY_KEYS, DEFAULT_BOT_COPY, type BotCopyKey };

const BOT_SETTINGS_QUERY = groq`*[_type == "botSettings" && _id == "botSettings"][0]{
  messages[]{ key, title, body }
}`;

let cachedMap: Map<string, string> | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function loadCopyMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedMap && now - cachedAt < CACHE_MS) return cachedMap;

  const map = new Map<string, string>();
  for (const [key, def] of Object.entries(DEFAULT_BOT_COPY)) {
    map.set(key, def.body);
  }

  try {
    const client = getSanityClient();
    const raw = await client.fetch<{ messages?: { key?: string; body?: string }[] } | null>(
      BOT_SETTINGS_QUERY,
      {},
      { cache: 'no-store' },
    );
    for (const row of raw?.messages ?? []) {
      const key = row.key?.trim();
      const body = row.body?.trim();
      if (key && body) map.set(key, body);
    }
  } catch {
    // Sanity недоступен — только defaults
  }

  cachedMap = map;
  cachedAt = now;
  return map;
}

export async function getBotCopy(key: BotCopyKey): Promise<string> {
  const map = await loadCopyMap();
  return map.get(key) ?? DEFAULT_BOT_COPY[key].body;
}

export async function listBotCopyForAdmin(): Promise<
  Array<{ key: BotCopyKey; title: string; preview: string }>
> {
  const map = await loadCopyMap();
  return (Object.keys(DEFAULT_BOT_COPY) as BotCopyKey[]).map((key) => {
    const def = DEFAULT_BOT_COPY[key];
    const body = map.get(key) ?? def.body;
    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    return { key, title: def.title, preview };
  });
}

export function sanityStudioBotSettingsHint(): string {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
  return `https://${projectId}.sanity.studio/structure/botSettings;botSettings`;
}
