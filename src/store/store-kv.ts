// src/store/store-kv.ts
//
// Upstash Redis backend (Vercel-recommended after @vercel/kv was deprecated
// in 2025). Same store semantics as the file backend — single JSON value
// under one key, dedupe + age-out + max-20 enforced in the dispatcher's
// helpers. Stays a single key because the store holds ≤ 20 items, the
// blob is < 50KB, and the read-modify-write race characteristic matches
// the file backend (no regression).
//
// Env vars (auto-injected by Vercel when you connect an Upstash Redis
// integration to your project):
//   UPSTASH_REDIS_REST_URL    (https://… — the REST endpoint, NOT redis://)
//   UPSTASH_REDIS_REST_TOKEN  (bearer token)
//
// Redis.fromEnv() reads exactly those two env var names. The dispatcher
// in opportunity-store.ts also checks for those names before falling
// back to the file backend — keep them in sync.

import { Redis } from '@upstash/redis';
import {
  StoredOpportunity,
  StoredPost,
  MAX_ITEMS,
  isFresh,
  isRecentDuplicate,
} from './store-shared';

const redis = Redis.fromEnv();

const KEY = 'viralpulse:opportunities';
const POSTS_KEY = (handle: string) => `viralpulse:posts:${handle.toLowerCase()}`;

async function read(): Promise<StoredOpportunity[]> {
  const data = await redis.get<StoredOpportunity[]>(KEY);
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

  await redis.set(KEY, updated);
  return true;
}

export async function removeOpportunityKv(id: string): Promise<void> {
  const current = await read();
  await redis.set(
    KEY,
    current.filter((o) => o.id !== id),
  );
}

// ─── Posts backend ───────────────────────────────────────────────────────

async function readPosts(handle: string): Promise<StoredPost[]> {
  const data = await redis.get<StoredPost[]>(POSTS_KEY(handle));
  return Array.isArray(data) ? data : [];
}

export async function savePostKv(post: StoredPost): Promise<void> {
  const current = await readPosts(post.handle);
  const dedup = current.filter((p) => p.tweetId !== post.tweetId);
  await redis.set(POSTS_KEY(post.handle), [post, ...dedup]);
}

export async function readPostsKv(handle: string, limit?: number): Promise<StoredPost[]> {
  const all = await readPosts(handle);
  return typeof limit === 'number' ? all.slice(0, limit) : all;
}

export async function removePostKv(handle: string, tweetId: string): Promise<void> {
  const current = await readPosts(handle);
  await redis.set(
    POSTS_KEY(handle),
    current.filter((p) => p.tweetId !== tweetId),
  );
}
