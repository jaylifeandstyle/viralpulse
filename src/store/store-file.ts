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
