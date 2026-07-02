// src/store/store-shared.ts
//
// Shared types + invariants for both store backends (file + KV).
// The dispatcher in opportunity-store.ts decides which backend to use.

export type StoredOpportunity = {
  id: string;
  topic: string;
  viralityScore: number;
  confidence: number;
  draft: string;
  contentAngle: string;
  imageSearchQuery: string;
  /**
   * Optional. Real image URL extracted from the source article's OpenGraph
   * tags (Galaxy.04) or BBC RSS media:thumbnail. Pre-fills the Post Now
   * modal so the user doesn't have to find an image themselves.
   */
  imageUrl?: string;
  /**
   * Galaxy.07: up to 2 distinct images pre-loaded from fusion sources.
   */
  imageUrls?: string[];
  /**
   * Galaxy.07: direct MP4 URL (Reddit) uploadable to X.
   */
  videoUrl?: string;
  reasoning: string;
  shouldAct: boolean;
  roiEstimate: 'high' | 'medium' | 'low';
  hashtagSuggestions: string[];
  optimalPostTime: string;
  source: 'detector' | 'manual';
  detectedAt: string; // ISO string
  /** e.g. galaxy.05 — set when a galaxy tags its output */
  galaxyId?: string;
  /** Sub-variant within a galaxy, e.g. 05.01 | 05.02 */
  galaxyVariant?: string;
};

export const MAX_ITEMS = 20;        // never keep more than 20 cards
export const MAX_AGE_HOURS = 4;     // discard opportunities older than 4 hours
export const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour — skip duplicate topics

// ─── Posts (tweets shipped via ViralPulse) ────────────────────────────────
// Persistent — unlike opportunities, posts never age out or dedupe.

export type StoredPost = {
  tweetId: string;
  /** X handle of the post owner, lowercase, no '@'. */
  handle: string;
  text: string;
  imageUrl?: string;
  /** ISO timestamp of when the tweet was sent. */
  postedAt: string;
  /** Source opportunity topic, if posted via the dashboard. */
  opportunityTopic?: string;
  contentAngle?: string;
  /**
   * X public engagement metrics. Captured opportunistically from the X
   * syndication CDN at post time (free, unauthenticated) — may be absent
   * for very-recently-posted tweets because the CDN takes ~30-60s to
   * populate. Refreshed later by a background job.
   */
  xStats?: {
    favoriteCount: number;
    retweetCount: number;
    replyCount: number;
    capturedAt: string;
  };
};

// ─── Profiles (single-profile launch, scoped by handle for forward-compat)

export type StoredProfile = {
  handle: string;          // lowercase, no '@'
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  followersCount?: number;
  followingCount?: number;
  /** ISO of last refresh from X (so the cache layer can decide TTL). */
  fetchedAt: string;
};

/**
 * User-set overrides layered on top of the X-fetched profile.
 *
 * Kept separate from StoredProfile so an X data refresh (which happens
 * automatically on the 24h cache cycle) can never clobber the user's
 * curated values. Any field that's set here wins over the X version at
 * read time; unset fields fall through to the X data.
 */
export type StoredProfileOverrides = {
  handle: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  updatedAt: string;
};

// ─── Growth targets (G3) ─────────────────────────────────────────────────
// The curated set of accounts we reply to / quote-tweet to grow the owner
// account's audience. Keyed by owner handle so the multi-user future is
// zero-migration.

export type StoredTarget = {
  /** Owner whose target list this belongs to. */
  ownerHandle: string;
  /** Target account handle, lowercase, no '@'. */
  handle: string;
  displayName?: string;
  bio?: string;
  followersCount?: number;
  /** Claude's one-line justification when the target was proposed. */
  reason?: string;
  /** How this target got on the list. */
  source: 'claude' | 'manual';
  /** Lifecycle. */
  status: 'active' | 'paused' | 'dropped';
  addedAt: string;
  /** ISO of the last action taken against this target — used for cool-downs. */
  lastActedAt?: string;
};

export function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < MAX_AGE_HOURS * 60 * 60 * 1000;
}

export function isRecentDuplicate(
  opp: StoredOpportunity,
  current: StoredOpportunity[],
): boolean {
  return current.some(
    (o) =>
      o.topic === opp.topic &&
      Date.now() - new Date(o.detectedAt).getTime() < DEDUPE_WINDOW_MS,
  );
}
