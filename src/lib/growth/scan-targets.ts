/**
 * src/lib/growth/scan-targets.ts
 *
 * The scan loop: for each active target that's due for a scan, fetch
 * their recent tweets, ask Claude Haiku to draft a reply or quote-tweet
 * for the best one, and stack the draft in the approval queue.
 *
 * All guardrails live here — quiet hours, per-target daily cap, per-tweet
 * dedupe, freshness cut-off. Callers (cron and manual trigger) share the
 * same code path so behavior stays consistent.
 */

import { TwitterApi } from 'twitter-api-v2';
import { readTargets, updateTarget } from '@/store/target-store';
import { readCandidates, saveCandidate } from '@/store/candidate-store';
import {
  readTodayBudget,
  usedForTarget,
  perTargetLimit,
  timezone,
} from '@/store/budget-store';
import type { StoredTarget, StoredCandidate } from '@/store/store-shared';
import { draftCandidate } from './draft-candidate';

// ─── Tunables ────────────────────────────────────────────────────────────

const SCAN_INTERVAL_HOURS = 2;
const TWEETS_PER_TARGET = 5;
const TWEET_MAX_AGE_HOURS = 12;
const CANDIDATE_EXPIRY_HOURS = 6;

function quietHours(): { start: number; end: number } {
  const start = Number(process.env.VP_QUIET_HOURS_START ?? '0');
  const end = Number(process.env.VP_QUIET_HOURS_END ?? '6');
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 6,
  };
}

/** Returns local hour in the owner's timezone. */
function hourInOwnerTz(): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone(),
  }).format(new Date());
  return Number(hourStr);
}

export function isQuietNow(): boolean {
  const { start, end } = quietHours();
  const h = hourInOwnerTz();
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  // wraparound (e.g. 22–6)
  return h >= start || h < end;
}

// ─── Client (owner-scoped) ───────────────────────────────────────────────

function buildClient(): TwitterApi {
  const appKey = process.env.X_CLIENT_ID;
  const appSecret = process.env.X_CLIENT_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error(
      'X credentials missing — cannot scan targets. Need X_CLIENT_ID, X_CLIENT_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.',
    );
  }
  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

// ─── Scan flow ───────────────────────────────────────────────────────────

export type ScanReport = {
  targetsConsidered: number;
  targetsScanned: number;
  candidatesCreated: number;
  candidatesSkipped: number;
  notes: string[];
  quietSkipped: boolean;
};

type Loose = Record<string, unknown>;
function asObj(v: unknown): Loose {
  return (v && typeof v === 'object' ? (v as Loose) : {}) as Loose;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hoursSince(iso: string | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function candidateId(targetHandle: string, sourceTweetId: string): string {
  return `c_${targetHandle}_${sourceTweetId}`;
}

async function resolveUserId(
  client: TwitterApi,
  target: StoredTarget,
  notes: string[],
): Promise<string | null> {
  if (target.xUserId) return target.xUserId;
  try {
    const res = await client.v2.userByUsername(target.handle);
    const id = res.data?.id;
    if (!id) {
      notes.push(`@${target.handle}: user lookup returned no id`);
      return null;
    }
    await updateTarget(target.ownerHandle, target.handle, { xUserId: id });
    return id;
  } catch (err) {
    notes.push(`@${target.handle}: user lookup failed — ${errMsg(err)}`);
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type FetchedTweet = {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  url: string;
  isReply: boolean;
  isRetweet: boolean;
};

async function fetchTargetTweets(
  client: TwitterApi,
  target: StoredTarget,
  userId: string,
  notes: string[],
): Promise<FetchedTweet[]> {
  try {
    const res = await client.v2.userTimeline(userId, {
      max_results: TWEETS_PER_TARGET,
      exclude: ['retweets', 'replies'],
      'tweet.fields': ['text', 'created_at', 'public_metrics', 'referenced_tweets'],
    });
    const r = asObj(res);
    const items = ((asObj(r._realData).data ?? []) as Loose[]).concat((r.data as Loose[]) ?? []);
    return items.map((t) => {
      const metrics = asObj(t.public_metrics);
      const refs = (t.referenced_tweets as Loose[]) ?? [];
      return {
        id: (t.id as string) ?? '',
        text: (t.text as string) ?? '',
        createdAt: (t.created_at as string) ?? nowIso(),
        likeCount: Number(metrics.like_count ?? 0),
        replyCount: Number(metrics.reply_count ?? 0),
        retweetCount: Number(metrics.retweet_count ?? 0),
        url: `https://x.com/${target.handle}/status/${t.id ?? ''}`,
        isReply: refs.some((r) => r.type === 'replied_to'),
        isRetweet: refs.some((r) => r.type === 'retweeted'),
      };
    });
  } catch (err) {
    notes.push(`@${target.handle}: tweet fetch failed — ${errMsg(err)}`);
    return [];
  }
}

/**
 * Pull the owner's own recent tweets to feed as voice samples to Claude.
 * Fetched once per scan run — passed to every draft call.
 */
async function fetchOwnerVoice(
  client: TwitterApi,
  ownerHandle: string,
  notes: string[],
): Promise<string[]> {
  try {
    const me = await client.v2.userByUsername(ownerHandle);
    const id = me.data?.id;
    if (!id) return [];
    const res = await client.v2.userTimeline(id, {
      max_results: 20,
      exclude: ['retweets'],
      'tweet.fields': ['text'],
    });
    const r = asObj(res);
    const items = ((asObj(r._realData).data ?? []) as Loose[]).concat((r.data as Loose[]) ?? []);
    return items
      .map((t) => ((t.text as string) ?? '').trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch (err) {
    notes.push(`Owner voice fetch failed — ${errMsg(err)}`);
    return [];
  }
}

export type ScanOptions = {
  /**
   * When true, the quiet-hours check is skipped. Set from manual "Scan
   * now" triggers where the human is actively watching; the cron path
   * always respects quiet hours.
   */
  force?: boolean;
};

export async function scanTargets(
  ownerHandle: string,
  options: ScanOptions = {},
): Promise<ScanReport> {
  const report: ScanReport = {
    targetsConsidered: 0,
    targetsScanned: 0,
    candidatesCreated: 0,
    candidatesSkipped: 0,
    notes: [],
    quietSkipped: false,
  };

  if (!options.force && isQuietNow()) {
    report.quietSkipped = true;
    report.notes.push(`Quiet hours in ${timezone()} — scan skipped.`);
    return report;
  }

  const targets = (await readTargets(ownerHandle)).filter((t) => t.status === 'active');
  report.targetsConsidered = targets.length;
  if (!targets.length) {
    report.notes.push('No active targets.');
    return report;
  }

  const client = buildClient();
  const [existingCandidates, budget, voice] = await Promise.all([
    readCandidates(ownerHandle),
    readTodayBudget(ownerHandle),
    fetchOwnerVoice(client, ownerHandle, report.notes),
  ]);

  // Fast-lookup set of source tweet ids we've already got in the queue for
  // this owner — dedupes across scans so we never draft the same tweet twice.
  const draftedTweetIds = new Set(
    existingCandidates
      .filter((c) => c.ownerHandle === ownerHandle)
      .map((c) => c.sourceTweetId),
  );

  const perTargetCap = perTargetLimit();

  for (const target of targets) {
    if (hoursSince(target.lastScannedAt) < SCAN_INTERVAL_HOURS) {
      continue; // scanned recently, skip
    }
    if (usedForTarget(budget, target.handle) >= perTargetCap) {
      report.notes.push(`@${target.handle}: already hit per-target daily cap.`);
      continue;
    }

    report.targetsScanned++;

    const userId = await resolveUserId(client, target, report.notes);
    if (!userId) continue;

    const tweets = await fetchTargetTweets(client, target, userId, report.notes);

    // Filter for scan-worthy tweets: fresh, not already drafted, engagement present.
    const candidateTweets = tweets.filter((t) => {
      if (draftedTweetIds.has(t.id)) return false;
      if (t.isRetweet) return false;
      if (hoursSince(t.createdAt) > TWEET_MAX_AGE_HOURS) return false;
      // Skip zero-engagement tweets — signals no audience to convert.
      if (t.likeCount + t.replyCount + t.retweetCount === 0) return false;
      return true;
    });

    if (!candidateTweets.length) {
      report.notes.push(`@${target.handle}: no fresh scan-worthy tweets.`);
      await updateTarget(ownerHandle, target.handle, { lastScannedAt: nowIso() });
      continue;
    }

    // Top 1 for now — quality over quantity in the queue. Later, we can
    // relax to 2 once we see how the approval rate looks.
    const top = candidateTweets
      .sort((a, b) => b.likeCount + b.replyCount - (a.likeCount + a.replyCount))
      .slice(0, 1);

    for (const tweet of top) {
      try {
        const draft = await draftCandidate({
          ownerHandle,
          targetHandle: target.handle,
          targetBio: target.bio,
          sourceTweetText: tweet.text,
          voiceSamples: voice,
        });
        if (!draft) {
          report.candidatesSkipped++;
          continue;
        }
        const candidate: StoredCandidate = {
          id: candidateId(target.handle, tweet.id),
          ownerHandle,
          targetHandle: target.handle,
          sourceTweetId: tweet.id,
          sourceTweetText: tweet.text,
          sourceTweetUrl: tweet.url,
          sourceLikeCount: tweet.likeCount,
          sourceReplyCount: tweet.replyCount,
          sourceRetweetCount: tweet.retweetCount,
          action: draft.action,
          draft: draft.draft,
          reasoning: draft.reasoning,
          status: 'pending',
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + CANDIDATE_EXPIRY_HOURS * 3_600_000).toISOString(),
        };
        await saveCandidate(candidate);
        draftedTweetIds.add(tweet.id);
        report.candidatesCreated++;
      } catch (err) {
        report.notes.push(`@${target.handle}: draft failed — ${errMsg(err)}`);
        report.candidatesSkipped++;
      }
    }

    await updateTarget(ownerHandle, target.handle, { lastScannedAt: nowIso() });
  }

  return report;
}
