import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from 'next-sanity';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'));

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
const readToken = process.env.SANITY_API_READ_TOKEN ?? process.env.SANITY_API_WRITE_TOKEN;
const isDev = process.env.NODE_ENV !== 'production';

function getSanityClient({ preview, includeDrafts } = {}) {
  const useDrafts = Boolean(preview || includeDrafts);
  const token = readToken && (true || useDrafts) ? readToken : undefined;
  return createClient({
    projectId,
    dataset,
    apiVersion: '2023-03-17',
    useCdn: !useDrafts && !isDev && !token,
    token,
    perspective: preview ? 'previewDrafts' : useDrafts ? 'raw' : 'published',
  });
}

const slug = 'kurs-district';
const docId = `districtCourse.${slug}`;
const q = `*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
  "slug": slug.current,
  pricing,
  priceByn,
  grantedLessons,
  purchaseScenarios
}`;

const client = getSanityClient();
const r = await client.fetch(q, { slug, docId });
console.log('getSanityClient() default (like checkout):');
console.log(JSON.stringify(r, null, 2));

const clientDrafts = getSanityClient({ includeDrafts: true });
const r2 = await clientDrafts.fetch(q, { slug, docId });
console.log('\nwith includeDrafts:');
console.log(JSON.stringify(r2, null, 2));
