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
  MAX_ITEMS,
  isFresh,
  isRecentDuplicate,
} from './store-shared';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'opportunities.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
