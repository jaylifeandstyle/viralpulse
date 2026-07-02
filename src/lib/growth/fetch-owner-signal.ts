/**
 * src/lib/growth/fetch-owner-signal.ts
 *
 * Pulls the raw X data used as input to the target-proposal analysis:
 *   - recent tweets (mostly replies — reveals who they engage with)
 *   - following list (their curated lane)
 *   - bookmarks (tightest interest signal)
 *   - recent likes (softer interest signal)
 *
 * Uses the OWNER's OAuth tokens (posting-configured account). All calls
 * are best-effort — if any slice fails we still return what we have so
 * Claude can work with a partial picture. Downstream code should not
 * assume every field is populated.
 *
 * Cost note — each of these hits the paid X v2 API. Bounded fetch sizes
 * below cap the one-time analysis to well under $20 even at conservative
 * pay-per-use rates.
 */

import { TwitterApi } from 'twitter-api-v2';

const MAX_TWEETS = 100;
const MAX_FOLLOWING = 200;
const MAX_BOOKMARKS = 50;
const MAX_LIKES = 50;

export type MentionSlice = {
  /** Handle the owner mentioned or replied to. */
  handle: string;
  /** How many times this handle showed up in the sampled tweets. */
  count: number;
};

export type OwnerSignal = {
  handle: string;
  /** Ranked by frequency: who the owner talks about most. */
  frequentMentions: MentionSlice[];
  /** Text sample from the owner's recent tweets — Claude uses it for voice. */
  recentTweetSamples: string[];
  /** Accounts the owner follows (handles only, lowercased). */
  following: string[];
  /** Text of recent bookmarks — tightest interest signal. */
  bookmarkedTexts: string[];
  /** Authors of recent bookmarks. */
  bookmarkedAuthors: string[];
  /** Authors of recent likes. */
  likedAuthors: string[];
  /** Per-slice notes for the UI (e.g. "Bookmarks: not authorized"). */
  notes: string[];
};

function buildClient(): TwitterApi {
  const appKey = process.env.X_CLIENT_ID;
  const appSecret = process.env.X_CLIENT_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error(
      'X posting credentials missing — cannot fetch owner signal. Need X_CLIENT_ID, X_CLIENT_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.',
    );
  }
  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

export async function fetchOwnerSignal(handle: string): Promise<OwnerSignal> {
  const client = buildClient();
  const notes: string[] = [];

  // Resolve numeric id — every other endpoint needs it.
  let userId: string | undefined;
  try {
    const me = await client.v2.userByUsername(handle);
    userId = me.data?.id;
  } catch (err) {
    notes.push(`User lookup failed: ${errMsg(err)}`);
  }
  if (!userId) {
    return blankSignal(handle, [
      'Could not resolve @' + handle + ' — no signal fetched.',
      ...notes,
    ]);
  }

  const [tweetsRes, followingRes, bookmarksRes, likesRes] = await Promise.allSettled([
    client.v2.userTimeline(userId, {
      max_results: MAX_TWEETS,
      'tweet.fields': ['text', 'in_reply_to_user_id', 'entities'],
      expansions: ['in_reply_to_user_id', 'entities.mentions.username'],
    }),
    client.v2.following(userId, {
      max_results: MAX_FOLLOWING,
      'user.fields': ['username'],
    }),
    client.v2.bookmarks({
      max_results: MAX_BOOKMARKS,
      'tweet.fields': ['text', 'author_id'],
      expansions: ['author_id'],
    }),
    client.v2.userLikedTweets(userId, {
      max_results: MAX_LIKES,
      'tweet.fields': ['author_id'],
      expansions: ['author_id'],
    }),
  ]);

  const frequentMentions = extractMentions(tweetsRes, notes);
  const recentTweetSamples = extractTweetSamples(tweetsRes, notes);
  const following = extractFollowing(followingRes, notes);
  const { texts: bookmarkedTexts, authors: bookmarkedAuthors } = extractBookmarks(
    bookmarksRes,
    notes,
  );
  const likedAuthors = extractLikedAuthors(likesRes, notes);

  return {
    handle,
    frequentMentions,
    recentTweetSamples,
    following,
    bookmarkedTexts,
    bookmarkedAuthors,
    likedAuthors,
    notes,
  };
}

// ─── Slice extractors ────────────────────────────────────────────────────

type Settled<T> = PromiseSettledResult<T>;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function blankSignal(handle: string, notes: string[]): OwnerSignal {
  return {
    handle,
    frequentMentions: [],
    recentTweetSamples: [],
    following: [],
    bookmarkedTexts: [],
    bookmarkedAuthors: [],
    likedAuthors: [],
    notes,
  };
}

// twitter-api-v2 timeline shape is generic — narrow with defensive property
// checks. We deliberately treat the SDK response as loose data.
type Loose = Record<string, unknown>;

function asObj(v: unknown): Loose {
  return (v && typeof v === 'object' ? (v as Loose) : {}) as Loose;
}

function extractMentions(
  res: Settled<unknown>,
  notes: string[],
): MentionSlice[] {
  if (res.status !== 'fulfilled') {
    notes.push(`Recent tweets: ${errMsg(res.reason)}`);
    return [];
  }
  const r = asObj(res.value);
  const tweets = ((asObj(r._realData).data ?? []) as Loose[])
    .concat((r.data as Loose[]) ?? []);
  const counts = new Map<string, number>();
  for (const t of tweets) {
    const entities = asObj(t.entities);
    const mentions = (entities.mentions as Loose[]) ?? [];
    for (const m of mentions) {
      const u = ((m.username as string) ?? '').toLowerCase();
      if (u) counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([handle, count]) => ({ handle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

function extractTweetSamples(res: Settled<unknown>, notes: string[]): string[] {
  if (res.status !== 'fulfilled') return [];
  const r = asObj(res.value);
  const tweets = ((asObj(r._realData).data ?? []) as Loose[])
    .concat((r.data as Loose[]) ?? []);
  const texts = tweets
    .map((t) => ((t.text as string) ?? '').trim())
    .filter(Boolean)
    .slice(0, 40);
  if (!texts.length) notes.push('Recent tweets: none returned.');
  return texts;
}

function extractFollowing(res: Settled<unknown>, notes: string[]): string[] {
  if (res.status !== 'fulfilled') {
    notes.push(`Following list: ${errMsg(res.reason)}`);
    return [];
  }
  const r = asObj(res.value);
  const users = ((asObj(r._realData).data ?? []) as Loose[])
    .concat((r.data as Loose[]) ?? []);
  return users
    .map((u) => ((u.username as string) ?? '').toLowerCase())
    .filter(Boolean);
}

function extractBookmarks(
  res: Settled<unknown>,
  notes: string[],
): { texts: string[]; authors: string[] } {
  if (res.status !== 'fulfilled') {
    notes.push(`Bookmarks: ${errMsg(res.reason)}`);
    return { texts: [], authors: [] };
  }
  const r = asObj(res.value);
  const tweets = ((asObj(r._realData).data ?? []) as Loose[])
    .concat((r.data as Loose[]) ?? []);
  const includes = asObj(asObj(r._realData).includes ?? r.includes);
  const users = (includes.users as Loose[]) ?? [];
  const usernameById = new Map<string, string>();
  for (const u of users) {
    const id = u.id as string;
    const username = u.username as string;
    if (id && username) usernameById.set(id, username.toLowerCase());
  }
  const texts = tweets
    .map((t) => ((t.text as string) ?? '').trim())
    .filter(Boolean)
    .slice(0, 40);
  const authors = tweets
    .map((t) => usernameById.get(t.author_id as string))
    .filter((u): u is string => !!u);
  return { texts, authors };
}

function extractLikedAuthors(res: Settled<unknown>, notes: string[]): string[] {
  if (res.status !== 'fulfilled') {
    notes.push(`Recent likes: ${errMsg(res.reason)}`);
    return [];
  }
  const r = asObj(res.value);
  const tweets = ((asObj(r._realData).data ?? []) as Loose[])
    .concat((r.data as Loose[]) ?? []);
  const includes = asObj(asObj(r._realData).includes ?? r.includes);
  const users = (includes.users as Loose[]) ?? [];
  const usernameById = new Map<string, string>();
  for (const u of users) {
    const id = u.id as string;
    const username = u.username as string;
    if (id && username) usernameById.set(id, username.toLowerCase());
  }
  return tweets
    .map((t) => usernameById.get(t.author_id as string))
    .filter((u): u is string => !!u);
}
