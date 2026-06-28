// POST /api/waitlist
// Body: { email, source? }
//
// Records the email in a single Redis set so duplicates are auto-deduped.
// Returns the current count so the UI can flex (`Joined by N creators`).

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';

const KEY = 'viralpulse:waitlist';
const FILE_PATH = path.join(process.cwd(), 'data', 'waitlist.json');

function kvConfigured(): boolean {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

type Entry = { email: string; source?: string; joinedAt: string };

async function addEntryKv(entry: Entry): Promise<number> {
  const redis = Redis.fromEnv();
  await redis.sadd(KEY, entry.email.toLowerCase());
  await redis.hset(`${KEY}:meta`, {
    [entry.email.toLowerCase()]: JSON.stringify(entry),
  });
  return await redis.scard(KEY);
}

function readFile(): Entry[] {
  if (!fs.existsSync(FILE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function addEntryFile(entry: Entry): number {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = readFile();
  if (!current.some((e) => e.email.toLowerCase() === entry.email.toLowerCase())) {
    current.push(entry);
    fs.writeFileSync(FILE_PATH, JSON.stringify(current, null, 2), 'utf-8');
  }
  return current.length;
}

export async function POST(req: Request) {
  let body: { email?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const source = body.source?.trim() || undefined;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ success: false, error: 'Invalid email' }, { status: 400 });
  }

  const entry: Entry = { email, source, joinedAt: new Date().toISOString() };

  try {
    const count = kvConfigured() ? await addEntryKv(entry) : addEntryFile(entry);
    return NextResponse.json({ success: true, count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (kvConfigured()) {
      const redis = Redis.fromEnv();
      const count = await redis.scard(KEY);
      return NextResponse.json({ count });
    }
    return NextResponse.json({ count: readFile().length });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
