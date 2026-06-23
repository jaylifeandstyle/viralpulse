// src/store/store-kv.ts
//
// Vercel KV backend. Used in production deployments where the filesystem
// is ephemeral (every serverless invocation gets a fresh /tmp; data/ is
// read-only). Stores the entire opportunity array as one JSON value under
// a single key — matches the file backend's semantics exactly.
//
// Why a single key (not a Redis sorted set or list):
//   - The store holds ≤ MAX_ITEMS (20). One JSON blob is < 50KB.
//   - Reading the whole array on every push is fine at this scale.
//   - Read-modify-write race is the same characteristic as the file
//     backend — no regression.
//
// Required env vars (auto-set by Vercel when you provision a KV database
// from the Storage tab of your project):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
// (KV_REST_API_READ_ONLY_TOKEN is also auto-set but we don't need it.)

import { kv } from '@vercel/kv';
import {
  StoredOpportunity,
  MAX_ITEMS,
  isFresh,
  isRecentDuplicate,
} from './store-shared';

const KEY = 'viralpulse:opportunities';

async function read(): Promise<StoredOpportunity[]> {
  // @vercel/kv parses JSON automatically when you set with set(key, obj).
  const data = await kv.get<StoredOpportunity[]>(KEY);
  return Array.isArray(data) ? data : [];
}

// ─── Backend interface ───────────────────────────────────────────────────

export async function readOpportunitiesKv(): Promise<StoredOpportunity[]> {
  const all = await read();
  return all.filter((o) => isFresh(o.detectedAt));
}

/** Returns true if the opp was actually written (false on dedupe). */
export async function pushOpportunityKv(
  opp: StoredOpportunity,
): Promise<boolean> {
  const current = await read();
  if (isRecentDuplicate(opp, current)) return false;

  const updated = [opp, ...current]
    .filter((o) => isFresh(o.detectedAt))
    .slice(0, MAX_ITEMS);

  await kv.set(KEY, updated);
  return true;
}

export async function removeOpportunityKv(id: string): Promise<void> {
  const current = await read();
  await kv.set(KEY, current.filter((o) => o.id !== id));
}
