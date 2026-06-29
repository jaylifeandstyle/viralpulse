/**
 * src/scripts/waitlist-list.ts
 *
 * Prints every email currently on the waitlist with its joined-at and
 * source (hero / bottom / like / comment / reshare / generic). Reads
 * from whichever backend is configured (file locally, Upstash on Vercel).
 *
 * Usage:
 *   npm run waitlist:list
 *
 * To inspect the production waitlist from your laptop, copy
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from Vercel into
 * your .env.local first.
 */

import fs from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';

const KEY = 'viralpulse:waitlist';

type Entry = { email: string; source?: string; joinedAt: string };

function kvConfigured(): boolean {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

async function readKv(): Promise<Entry[]> {
  const redis = Redis.fromEnv();
  const meta = await redis.hgetall<Record<string, Entry | string>>(`${KEY}:meta`);
  if (!meta) return [];
  return Object.values(meta).map((v) =>
    typeof v === 'string' ? (JSON.parse(v) as Entry) : v,
  );
}

function readFile(): Entry[] {
  const p = path.join(process.cwd(), 'data', 'waitlist.json');
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

async function main() {
  const entries = kvConfigured() ? await readKv() : readFile();
  entries.sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1));

  if (!entries.length) {
    console.log('No waitlist signups yet.');
    return;
  }

  console.log(`\n${entries.length} signups:\n`);
  for (const e of entries) {
    const when = new Date(e.joinedAt).toLocaleString();
    console.log(`  ${e.email.padEnd(40)} ${(e.source ?? '—').padEnd(10)} ${when}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
