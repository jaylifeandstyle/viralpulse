import type { ContentCandidate } from '../types';
import { extractEntities } from '../shared/keywords';

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type RedditPostData = {
  title?: string;
  url?: string;
  selftext?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  subreddit?: string;
  is_video?: boolean;
  thumbnail?: string;
  permalink?: string;
  preview?: { images?: Array<{ source?: { url?: string } }> };
  media?: { reddit_video?: { fallback_url?: string } };
};

type RedditListing = {
  data?: { children?: Array<{ data?: RedditPostData }> };
};

function tractionFromReddit(score: number, comments: number, ageHours: number): number {
  const velocity = (score + comments * 2) / Math.max(ageHours, 0.25);
  return Math.min(100, Math.round(velocity / 8));
}

function extractRedditImages(d: RedditPostData): string[] {
  const urls: string[] = [];
  for (const img of d.preview?.images ?? []) {
    const src = img.source?.url?.replace(/&amp;/g, '&');
    if (src?.startsWith('http')) urls.push(src);
  }
  const thumb = d.thumbnail;
  if (thumb && thumb.startsWith('http') && !thumb.includes('default')) {
    urls.push(thumb);
  }
  if (d.url?.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
    urls.push(d.url);
  }
  return urls;
}

async function fetchSubreddit(path: string, limit: number): Promise<ContentCandidate[]> {
  const url = `https://www.reddit.com${path}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as RedditListing;
  const children = json.data?.children ?? [];
  const out: ContentCandidate[] = [];

  for (const child of children) {
    const d = child.data;
    if (!d?.title) continue;

    const ageHours = d.created_utc
      ? (Date.now() / 1000 - d.created_utc) / 3600
      : 24;
    const score = d.score ?? 0;
    if (score < 50 && ageHours > 2) continue;

    const directVideo = d.media?.reddit_video?.fallback_url;
    const isVideo =
      !!d.is_video ||
      !!directVideo ||
      /v\.redd\.it|youtube\.com|youtu\.be|tiktok\.com/i.test(d.url ?? '');
    const imageUrls = extractRedditImages(d);

    out.push({
      id: `reddit_${d.permalink ?? d.title}`.slice(0, 64),
      platform: 'reddit',
      title: d.title.slice(0, 240),
      url: d.url?.startsWith('http') ? d.url : `https://www.reddit.com${d.permalink ?? ''}`,
      description: (d.selftext ?? '').slice(0, 280) || `r/${d.subreddit ?? 'unknown'}`,
      mediaType: isVideo ? 'video' : imageUrls.length ? 'image' : 'link',
      tractionScore: tractionFromReddit(score, d.num_comments ?? 0, ageHours),
      rawMetrics: { score, comments: d.num_comments, ageHours },
      entities: extractEntities(d.title),
      publishedAt: d.created_utc
        ? new Date(d.created_utc * 1000).toISOString()
        : undefined,
      imageUrls,
      directVideoUrl: directVideo,
    });
  }

  return out;
}

/** Reddit rising + hot video — free, no API key. */
export async function fetchRedditCandidates(limitPerFeed = 12): Promise<ContentCandidate[]> {
  const feeds = await Promise.all([
    fetchSubreddit('/r/all/rising', limitPerFeed),
    fetchSubreddit('/r/videos/hot', Math.min(limitPerFeed, 8)),
    fetchSubreddit('/r/news/hot', Math.min(limitPerFeed, 8)),
  ]);

  const seen = new Set<string>();
  const merged: ContentCandidate[] = [];
  for (const item of feeds.flat()) {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged.sort((a, b) => b.tractionScore - a.tractionScore);
}
