/**
 * Ручное подтверждение покупки (до подключения эквайринга).
 *
 * npm run fulfill:purchase -- --telegram=123456789 --product=course
 * npm run fulfill:purchase -- --phone=+375291234567 --product=individual --package=0 --teacher=anna
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import {
  fulfillPurchase,
  fulfillPurchaseByPhone,
  PurchaseFulfillError,
  type PurchaseFulfillInput,
} from '../src/lib/bot/purchase-fulfillment';
import { isAccessProduct } from '../src/lib/bot/accesses';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  }
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const telegramRaw = arg('telegram');
const phone = arg('phone');
const productRaw = arg('product');
const packageRaw = arg('package');
const teacherId = arg('teacher');
const externalId = arg('external');

if (!productRaw || !isAccessProduct(productRaw) || (!telegramRaw && !phone)) {
  console.error(`Usage:
  npm run fulfill:purchase -- --telegram=ID --product=course|individual|group [--package=N] [--teacher=id] [--external=key]
  npm run fulfill:purchase -- --phone=+375... --product=...`);
  process.exit(1);
}

const input: PurchaseFulfillInput = {
  product: productRaw,
  packageIndex: packageRaw != null ? Number(packageRaw) : undefined,
  teacherId,
  externalId,
};

async function main() {
  const admin = createAdminClient();
  try {
    const result = telegramRaw
      ? await fulfillPurchase(admin, Number(telegramRaw), input)
      : await fulfillPurchaseByPhone(admin, phone!, input);

    console.log(result.alreadyFulfilled ? 'Уже выполнено (externalId):' : 'OK:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof PurchaseFulfillError) {
      console.error(`[${error.code}] ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
