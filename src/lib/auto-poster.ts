/**
 * src/lib/auto-poster.ts
 *
 * Opt-in automatic posting for galaxy background processes.
 * Wraps postToX() with env gates, daily caps, and per-cycle limits.
 *
 * Enable: VP_AUTO_POST=true in .env.local (plus the four X OAuth creds — see x-poster.ts)
 * Daily cap: VP_AUTO_POST_MAX_DAY (default 5)
 */
import fs from 'fs';
import path from 'path';
import { postToX, isPostingConfigured } from '@/lib/x-poster';
import type { StoredOpportunity } from '@/store/opportunity-store';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOG_PATH = path.join(DATA_DIR, 'auto-post-log.json');

/** X pay-per-use: Post:Create without URL in body ≈ $0.015 */
export const X_POST_ESTIMATE_USD = 0.015;

const MAX_PER_DAY = Number(process.env.VP_AUTO_POST_MAX_DAY ?? 5);

type AutoPostLog = {
  date: string;
  count: number;
  posts: Array<{ topic: string; url: string; at: string }>;
};

export type AutoPostResult =
  | { posted: true; url: string; tweetId: string }
  | { posted: false; reason: string };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readLog(): AutoPostLog {
  ensureDir();
  if (!fs.existsSync(LOG_PATH)) {
    return { date: todayKey(), count: 0, posts: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch {
    return { date: todayKey(), count: 0, posts: [] };
  }
}

function writeLog(log: AutoPostLog) {
  ensureDir();
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True when VP_AUTO_POST=true and OAuth write creds are present. */
export function isAutoPostEnabled(): boolean {
  return process.env.VP_AUTO_POST === 'true' && isPostingConfigured();
}

let cyclePosted = false;

/** Call at the start of each galaxy cycle. */
export function resetAutoPostCycle(): void {
  cyclePosted = false;
}

/**
 * Post one opportunity to X if gates pass. At most one successful post
 * per cycle (call resetAutoPostCycle() at cycle start).
 */
export async function maybeAutoPostOncePerCycle(opp: StoredOpportunity): Promise<AutoPostResult> {
  if (cyclePosted) {
    return { posted: false, reason: 'already auto-posted this cycle' };
  }

  if (!isAutoPostEnabled()) {
    return {
      posted: false,
      reason: 'auto-post disabled (set VP_AUTO_POST=true and X OAuth creds)',
    };
  }

  if (!opp.shouldAct) {
    return { posted: false, reason: 'shouldAct is false' };
  }

  const draft = opp.draft?.trim();
  if (!draft) {
    return { posted: false, reason: 'empty draft' };
  }

  const log = readLog();
  if (log.date !== todayKey()) {
    log.date = todayKey();
    log.count = 0;
    log.posts = [];
  }

  if (log.count >= MAX_PER_DAY) {
    return { posted: false, reason: `daily cap reached (${MAX_PER_DAY}/day)` };
  }

  try {
    const result = await postToX({
      text: draft,
      imageUrl: opp.imageUrl,
    });

    log.count += 1;
    log.posts.push({
      topic: opp.topic.slice(0, 80),
      url: result.url,
      at: new Date().toISOString(),
    });
    writeLog(log);
    cyclePosted = true;

    console.log(
      `🚀  Auto-posted to X: ${result.url}  (~$${X_POST_ESTIMATE_USD.toFixed(3)} est.)`,
    );
    return { posted: true, url: result.url, tweetId: result.tweetId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌  Auto-post failed: ${msg}`);
    return { posted: false, reason: msg };
  }
}
