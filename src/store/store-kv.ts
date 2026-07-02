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
  StoredProfile,
  StoredProfileOverrides,
  StoredTarget,
  StoredCandidate,
  ActionBudget,
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

// ─── Profiles backend ────────────────────────────────────────────────────

const PROFILE_KEY = (handle: string) => `viralpulse:profile:${handle.toLowerCase()}`;

export async function readProfileKv(handle: string): Promise<StoredProfile | null> {
  return (await redis.get<StoredProfile>(PROFILE_KEY(handle))) ?? null;
}

export async function writeProfileKv(profile: StoredProfile): Promise<void> {
  await redis.set(PROFILE_KEY(profile.handle), profile);
}

const OVERRIDES_KEY = (handle: string) =>
  `viralpulse:profile-overrides:${handle.toLowerCase()}`;

export async function readProfileOverridesKv(handle: string): Promise<StoredProfileOverrides | null> {
  return (await redis.get<StoredProfileOverrides>(OVERRIDES_KEY(handle))) ?? null;
}

export async function writeProfileOverridesKv(o: StoredProfileOverrides): Promise<void> {
  await redis.set(OVERRIDES_KEY(o.handle), o);
}

// ─── Targets backend ─────────────────────────────────────────────────────

const TARGETS_KEY = (ownerHandle: string) =>
  `viralpulse:targets:${ownerHandle.toLowerCase()}`;

async function readTargets(ownerHandle: string): Promise<StoredTarget[]> {
  const data = await redis.get<StoredTarget[]>(TARGETS_KEY(ownerHandle));
  return Array.isArray(data) ? data : [];
}

export async function readTargetsKv(ownerHandle: string): Promise<StoredTarget[]> {
  return readTargets(ownerHandle);
}

export async function saveTargetsKv(
  ownerHandle: string,
  targets: StoredTarget[],
): Promise<void> {
  const existing = await readTargets(ownerHandle);
  const incoming = new Map(targets.map((t) => [t.handle.toLowerCase(), t]));
  const merged = existing.map((t) => incoming.get(t.handle.toLowerCase()) ?? t);
  for (const t of targets) {
    if (!existing.some((e) => e.handle.toLowerCase() === t.handle.toLowerCase())) {
      merged.push(t);
    }
  }
  await redis.set(TARGETS_KEY(ownerHandle), merged);
}

export async function removeTargetKv(ownerHandle: string, handle: string): Promise<void> {
  const current = await readTargets(ownerHandle);
  await redis.set(
    TARGETS_KEY(ownerHandle),
    current.filter((t) => t.handle.toLowerCase() !== handle.toLowerCase()),
  );
}

export async function updateTargetKv(
  ownerHandle: string,
  handle: string,
  patch: Partial<StoredTarget>,
): Promise<StoredTarget | null> {
  const current = await readTargets(ownerHandle);
  const idx = current.findIndex((t) => t.handle.toLowerCase() === handle.toLowerCase());
  if (idx === -1) return null;
  const updated = { ...current[idx], ...patch };
  current[idx] = updated;
  await redis.set(TARGETS_KEY(ownerHandle), current);
  return updated;
}

// ─── Candidates backend ──────────────────────────────────────────────────

const CANDIDATES_KEY = (ownerHandle: string) =>
  `viralpulse:candidates:${ownerHandle.toLowerCase()}`;

async function readCandidatesRaw(ownerHandle: string): Promise<StoredCandidate[]> {
  const data = await redis.get<StoredCandidate[]>(CANDIDATES_KEY(ownerHandle));
  return Array.isArray(data) ? data : [];
}

export async function readCandidatesKv(ownerHandle: string): Promise<StoredCandidate[]> {
  return readCandidatesRaw(ownerHandle);
}

export async function saveCandidateKv(candidate: StoredCandidate): Promise<void> {
  const current = await readCandidatesRaw(candidate.ownerHandle);
  const dedup = current.filter((c) => c.id !== candidate.id);
  await redis.set(CANDIDATES_KEY(candidate.ownerHandle), [candidate, ...dedup]);
}

export async function updateCandidateKv(
  ownerHandle: string,
  id: string,
  patch: Partial<StoredCandidate>,
): Promise<StoredCandidate | null> {
  const current = await readCandidatesRaw(ownerHandle);
  const idx = current.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated = { ...current[idx], ...patch };
  current[idx] = updated;
  await redis.set(CANDIDATES_KEY(ownerHandle), current);
  return updated;
}

// ─── Action budget backend ───────────────────────────────────────────────

const BUDGET_KEY = (ownerHandle: string, date: string) =>
  `viralpulse:budget:${ownerHandle.toLowerCase()}:${date}`;

export async function readBudgetKv(ownerHandle: string, date: string): Promise<ActionBudget | null> {
  return (await redis.get<ActionBudget>(BUDGET_KEY(ownerHandle, date))) ?? null;
}

export async function writeBudgetKv(budget: ActionBudget): Promise<void> {
  await redis.set(BUDGET_KEY(budget.ownerHandle, budget.date), budget);
}
