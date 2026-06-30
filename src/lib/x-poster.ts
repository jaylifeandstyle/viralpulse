// src/lib/x-poster.ts
//
// Posts tweets to X via OAuth 1.0a User Context.
// Supports single image (legacy), up to 2 images (Galaxy.07), or one MP4 video.

import { TwitterApi, ApiResponseError } from 'twitter-api-v2';
import { AccountId, getPostingAccount, getPostingAccounts } from './x-accounts';

// One client per account id, built lazily and reused.
const _clients = new Map<AccountId, TwitterApi>();

function getWriteClient(accountId: AccountId): TwitterApi {
  const cached = _clients.get(accountId);
  if (cached) return cached;

  const account = getPostingAccount(accountId);
  if (!account) {
    throw new Error(
      `X posting account "${accountId}" is not configured. ` +
        `Check the relevant access-token env vars.`,
    );
  }

  const client = new TwitterApi({
    appKey: account.appKey,
    appSecret: account.appSecret,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  });
  _clients.set(accountId, client);
  return client;
}

export function isPostingConfigured(): boolean {
  return getPostingAccounts().length > 0;
}

export type PostResult = {
  tweetId: string;
  url: string;
};

export type PostOptions = {
  text: string;
  /** Legacy single image (Galaxy.04 etc.). */
  imageUrl?: string;
  /** Up to 2 distinct images (Galaxy.07). */
  imageUrls?: string[];
  /** Direct MP4 URL — X allows one video OR images, not both. */
  videoUrl?: string;
  /** Which account to post as. Defaults to the owner account. */
  accountId?: AccountId;
};

export async function postToX(opts: PostOptions): Promise<PostResult> {
  const { text, imageUrl, videoUrl } = opts;

  if (!text?.trim()) throw new Error('Tweet text is empty.');
  if (text.length > 280) {
    throw new Error(`Tweet is ${text.length} chars — over the 280-char limit.`);
  }

  const client = getWriteClient(opts.accountId ?? 'owner');
  const imageList = dedupeUrls([...(opts.imageUrls ?? []), imageUrl]);

  let media_ids: string[] | undefined;

  if (videoUrl && /\.mp4(\?|$)/i.test(videoUrl)) {
    const videoId = await uploadVideoFromUrl(client, videoUrl);
    media_ids = [videoId];
  } else if (imageList.length > 0) {
    const ids = await Promise.all(imageList.slice(0, 2).map((u) => uploadImageFromUrl(client, u)));
    media_ids = ids;
  }

  try {
    const payload: Parameters<TwitterApi['v2']['tweet']>[0] = { text };
    if (media_ids?.length === 1) {
      payload.media = { media_ids: [media_ids[0]] };
    } else if (media_ids?.length === 2) {
      payload.media = { media_ids: [media_ids[0], media_ids[1]] };
    }
    const tweet = await client.v2.tweet(payload);
    const id = tweet.data.id;
    return { tweetId: id, url: `https://x.com/i/web/status/${id}` };
  } catch (err) {
    throw mapPostError(err);
  }
}

function dedupeUrls(urls: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const key = url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 30_000;

async function uploadImageFromUrl(client: TwitterApi, imageUrl: string): Promise<string> {
  const { buf, mimeType } = await fetchMediaBytes(imageUrl, 'image');
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) {
    throw new Error(`Not a supported image type: ${mimeType}`);
  }
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — over X's 5MB limit`);
  }
  try {
    return await client.v1.uploadMedia(buf, { mimeType });
  } catch (err) {
    throw new Error(`X image upload failed: ${(err as Error).message ?? err}`);
  }
}

async function uploadVideoFromUrl(client: TwitterApi, videoUrl: string): Promise<string> {
  const { buf, mimeType } = await fetchMediaBytes(videoUrl, 'video');
  const mime = mimeType.includes('video') ? mimeType : 'video/mp4';
  if (buf.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`Video is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — over 50MB cap`);
  }
  try {
    return await client.v1.uploadMedia(buf, { mimeType: mime, target: 'tweet' });
  } catch (err) {
    throw new Error(`X video upload failed: ${(err as Error).message ?? err}`);
  }
}

async function fetchMediaBytes(
  url: string,
  kind: 'image' | 'video',
): Promise<{ buf: Buffer; mimeType: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${kind} fetch failed: ${msg}`);
  }
  if (!res.ok) {
    throw new Error(`${kind} fetch returned ${res.status} ${res.statusText}`);
  }
  const mimeType = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error(`${kind} fetch returned empty body`);
  return { buf, mimeType };
}

function mapPostError(err: unknown): Error {
  if (err instanceof ApiResponseError) {
    const code = err.code;
    const detail = err.data?.detail || err.data?.title || err.message;
    if (code === 401) {
      return new Error('X auth failed (401). Re-check X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET.');
    }
    if (code === 403) {
      return new Error(
        `X rejected the post (403): ${detail}. Check Read+Write permissions and token regeneration.`,
      );
    }
    if (code === 429) {
      return new Error('X rate limit hit (429). Wait for the window to reset.');
    }
    return new Error(`X API error ${code}: ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
