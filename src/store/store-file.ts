// src/store/store-file.ts
//
// File-based backend. Used in local development and by background poller
// scripts (npm run galaxy04, npm run galaxy05, etc.) so the dashboard's
// Next.js process can see opportunities pushed by separate Node processes.
//
// Async signature is for API parity with the KV backend — the underlying
// fs calls are sync.

import fs from 'fs';
import path from 'path';
import {
  StoredOpportunity,
  StoredPost,
  StoredProfile,
  StoredProfileOverrides,
  StoredTarget,
  MAX_ITEMS,
  isFresh,
  isRecentDuplicate,
} from './store-shared';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'opportunities.json');
const POSTS_DIR = path.join(DATA_DIR, 'posts');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensurePostsDir() {
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
}

function postsPath(handle: string) {
  return path.join(POSTS_DIR, `${handle.toLowerCase()}.json`);
}

function read(): StoredOpportunity[] {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function write(items: StoredOpportunity[]) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), 'utf-8');
}

// ─── Backend interface ───────────────────────────────────────────────────

export async function readOpportunitiesFile(): Promise<StoredOpportunity[]> {
  return read().filter((o) => isFresh(o.detectedAt));
}

/** Returns true if the opp was actually written (false on dedupe). */
export async function pushOpportunityFile(
  opp: StoredOpportunity,
): Promise<boolean> {
  const current = read();
  if (isRecentDuplicate(opp, current)) return false;

  const updated = [opp, ...current]
    .filter((o) => isFresh(o.detectedAt))
    .slice(0, MAX_ITEMS);

  write(updated);
  return true;
}

export async function removeOpportunityFile(id: string): Promise<void> {
  write(read().filter((o) => o.id !== id));
}

// ─── Posts backend ───────────────────────────────────────────────────────

function readPosts(handle: string): StoredPost[] {
  ensurePostsDir();
  const p = postsPath(handle);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

function writePosts(handle: string, posts: StoredPost[]) {
  ensurePostsDir();
  fs.writeFileSync(postsPath(handle), JSON.stringify(posts, null, 2), 'utf-8');
}

export async function savePostFile(post: StoredPost): Promise<void> {
  const current = readPosts(post.handle);
  const dedup = current.filter((p) => p.tweetId !== post.tweetId);
  writePosts(post.handle, [post, ...dedup]);
}

export async function readPostsFile(handle: string, limit?: number): Promise<StoredPost[]> {
  const all = readPosts(handle);
  return typeof limit === 'number' ? all.slice(0, limit) : all;
}

export async function removePostFile(handle: string, tweetId: string): Promise<void> {
  writePosts(handle, readPosts(handle).filter((p) => p.tweetId !== tweetId));
}

// ─── Profiles backend ────────────────────────────────────────────────────

const PROFILES_DIR = path.join(DATA_DIR, 'profiles');

function ensureProfilesDir() {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function profilePath(handle: string) {
  return path.join(PROFILES_DIR, `${handle.toLowerCase()}.json`);
}

export async function readProfileFile(handle: string): Promise<StoredProfile | null> {
  ensureProfilesDir();
  const p = profilePath(handle);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export async function writeProfileFile(profile: StoredProfile): Promise<void> {
  ensureProfilesDir();
  fs.writeFileSync(profilePath(profile.handle), JSON.stringify(profile, null, 2), 'utf-8');
}

function overridesPath(handle: string) {
  return path.join(PROFILES_DIR, `${handle.toLowerCase()}.overrides.json`);
}

export async function readProfileOverridesFile(handle: string): Promise<StoredProfileOverrides | null> {
  ensureProfilesDir();
  const p = overridesPath(handle);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export async function writeProfileOverridesFile(o: StoredProfileOverrides): Promise<void> {
  ensureProfilesDir();
  fs.writeFileSync(overridesPath(o.handle), JSON.stringify(o, null, 2), 'utf-8');
}

// ─── Targets backend ─────────────────────────────────────────────────────

const TARGETS_DIR = path.join(DATA_DIR, 'targets');

function ensureTargetsDir() {
  if (!fs.existsSync(TARGETS_DIR)) fs.mkdirSync(TARGETS_DIR, { recursive: true });
}

function targetsPath(ownerHandle: string) {
  return path.join(TARGETS_DIR, `${ownerHandle.toLowerCase()}.json`);
}

function readTargetsRaw(ownerHandle: string): StoredTarget[] {
  ensureTargetsDir();
  const p = targetsPath(ownerHandle);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

function writeTargets(ownerHandle: string, targets: StoredTarget[]) {
  ensureTargetsDir();
  fs.writeFileSync(targetsPath(ownerHandle), JSON.stringify(targets, null, 2), 'utf-8');
}

export async function readTargetsFile(ownerHandle: string): Promise<StoredTarget[]> {
  return readTargetsRaw(ownerHandle);
}

export async function saveTargetsFile(
  ownerHandle: string,
  targets: StoredTarget[],
): Promise<void> {
  // Upsert semantics: incoming list replaces any existing entries for the
  // same handles, other handles are left alone.
  const existing = readTargetsRaw(ownerHandle);
  const incoming = new Map(targets.map((t) => [t.handle.toLowerCase(), t]));
  const merged = existing.map((t) => incoming.get(t.handle.toLowerCase()) ?? t);
  for (const t of targets) {
    if (!existing.some((e) => e.handle.toLowerCase() === t.handle.toLowerCase())) {
      merged.push(t);
    }
  }
  writeTargets(ownerHandle, merged);
}

export async function removeTargetFile(ownerHandle: string, handle: string): Promise<void> {
  writeTargets(
    ownerHandle,
    readTargetsRaw(ownerHandle).filter((t) => t.handle.toLowerCase() !== handle.toLowerCase()),
  );
}

export async function updateTargetFile(
  ownerHandle: string,
  handle: string,
  patch: Partial<StoredTarget>,
): Promise<StoredTarget | null> {
  const current = readTargetsRaw(ownerHandle);
  const idx = current.findIndex((t) => t.handle.toLowerCase() === handle.toLowerCase());
  if (idx === -1) return null;
  const updated = { ...current[idx], ...patch };
  current[idx] = updated;
  writeTargets(ownerHandle, current);
  return updated;
}
