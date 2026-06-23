// src/lib/x-poster.ts
//
// Actually posts tweets to X. The X_BEARER_TOKEN you already have is
// app-only auth which can READ but NOT POST — posting requires OAuth 1.0a
// User Context with four credentials tied to your X account:
//
//   X_CLIENT_ID                    (consumer key — already set)
//   X_CLIENT_SECRET                (consumer secret — already set)
//   X_ACCESS_TOKEN                 (NEW — your account's access token)
//   X_ACCESS_TOKEN_SECRET          (NEW — your account's access secret)
//
// Get the new two from developer.twitter.com → your project → Keys and tokens →
// "Access Token and Secret" → Generate. Your App's User authentication settings
// MUST be "Read and write" (not just "Read") or every post returns 403.
//
// All functions in this file no-op gracefully if the four creds aren't set,
// so the rest of the app keeps working even when posting isn't configured.

import { TwitterApi, ApiResponseError } from 'twitter-api-v2';

// ─────────────────────────────────────────────────────────────────────────────
// Lazy client. We instantiate once on first call and reuse — cheaper than
// recreating per request, but only created when there's actually credentials.
// ─────────────────────────────────────────────────────────────────────────────

let _writeClient: TwitterApi | null = null;

function getWriteClient(): TwitterApi {
  if (_writeClient) return _writeClient;

  const appKey = process.env.X_CLIENT_ID;
  const appSecret = process.env.X_CLIENT_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error(
      'X posting not configured. Need all four: X_CLIENT_ID, X_CLIENT_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in .env.local. See developer.twitter.com → your project → Keys and tokens → "Access Token and Secret" → Generate. Your app must have Read+Write permissions enabled.',
    );
  }

  _writeClient = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  return _writeClient;
}

/**
 * Cheap synchronous check — returns true iff the four env vars are present.
 * Use from API routes to early-reject without instantiating the client.
 */
export function isPostingConfigured(): boolean {
  return !!(
    process.env.X_CLIENT_ID &&
    process.env.X_CLIENT_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type PostResult = {
  tweetId: string;
  /** Permalink to the new tweet. */
  url: string;
};

export type PostOptions = {
  /** Tweet body (max 280 chars). Required. */
  text: string;
  /**
   * Optional image URL to attach. Fetched server-side, uploaded to X's
   * media endpoint, then attached via media_ids. Must be a publicly
   * reachable image (Twitter limit: 5MB photo / 15MB GIF).
   */
  imageUrl?: string;
};

/**
 * Post a tweet to X. Throws on auth/validation errors (caller maps to
 * HTTP responses). On success returns the new tweet id and permalink.
 */
export async function postToX(opts: PostOptions): Promise<PostResult> {
  const { text, imageUrl } = opts;

  // ── Validate text up-front — saves a wasted API call on obvious mistakes
  if (!text || !text.trim()) {
    throw new Error('Tweet text is empty.');
  }
  if (text.length > 280) {
    throw new Error(`Tweet is ${text.length} chars — over the 280-char limit.`);
  }

  const client = getWriteClient();

  // ── Optionally attach an image
  let media_ids: [string] | undefined;
  if (imageUrl) {
    const mediaId = await uploadImageFromUrl(client, imageUrl);
    media_ids = [mediaId];
  }

  // ── Post
  try {
    const tweet = await client.v2.tweet({
      text,
      ...(media_ids ? { media: { media_ids } } : {}),
    });
    const id = tweet.data.id;
    // X permalink works without username — twitter.com/i/web/status/{id} redirects
    return { tweetId: id, url: `https://x.com/i/web/status/${id}` };
  } catch (err) {
    throw mapPostError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image upload — download the URL then push to X's v1.1 media endpoint
// (twitter-api-v2's v2 client doesn't have its own upload yet)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // X's photo cap
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

async function uploadImageFromUrl(client: TwitterApi, imageUrl: string): Promise<string> {
  // ── Fetch the image
  let res: Response;
  try {
    res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)' },
    });
  } catch (err: any) {
    throw new Error(`Image fetch failed: ${err.message ?? err}`);
  }
  if (!res.ok) {
    throw new Error(`Image fetch returned ${res.status} ${res.statusText}`);
  }

  // ── Sanity-check the response
  const mimeType = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) {
    throw new Error(`Image fetch returned content-type "${mimeType || 'unknown'}" — must be image/jpeg|png|webp|gif`);
  }

  // ── Load bytes (bounded)
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('Image fetch returned empty body');
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — over X's 5MB limit`);
  }

  // ── Upload (v1.1 media endpoint via the SDK)
  try {
    const mediaId = await client.v1.uploadMedia(buf, { mimeType });
    return mediaId;
  } catch (err) {
    throw new Error(`X media upload failed: ${(err as Error).message ?? err}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error mapping — turns SDK errors into actionable messages
// ─────────────────────────────────────────────────────────────────────────────

function mapPostError(err: unknown): Error {
  if (err instanceof ApiResponseError) {
    const code = err.code;
    const detail = err.data?.detail || err.data?.title || err.message;
    if (code === 401) {
      return new Error('X auth failed (401). Re-check X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET in .env.local.');
    }
    if (code === 403) {
      // 403 is usually one of two things — surface both
      return new Error(
        `X rejected the post (403): ${detail}. Most common causes: (a) your app's User authentication settings are "Read only" — change to "Read and write" at developer.twitter.com → your project → User authentication settings → edit → permissions. After changing, you MUST regenerate the access token and secret. (b) duplicate tweet (X rejects identical text within ~24h).`,
      );
    }
    if (code === 429) {
      return new Error('X rate limit hit (429). Free tier is 17 posts/day, 500/month. Wait for the window to reset.');
    }
    return new Error(`X API error ${code}: ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
