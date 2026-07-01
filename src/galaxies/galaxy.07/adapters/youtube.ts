import type { ContentCandidate } from '../types';
import { extractEntities } from '../shared/keywords';

const FETCH_TIMEOUT_MS = 10000;

type YouTubeListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: {
        maxres?: { url?: string };
        high?: { url?: string };
        medium?: { url?: string };
        standard?: { url?: string };
      };
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
  }>;
};

function tractionFromYoutube(views: number, likes: number, ageHours: number): number {
  const velocity = (views / 1000 + likes * 5) / Math.max(ageHours, 1);
  return Math.min(100, Math.round(velocity / 10));
}

function youtubeThumbnails(snippet?: {
  thumbnails?: {
    maxres?: { url?: string };
    standard?: { url?: string };
    high?: { url?: string };
    medium?: { url?: string };
  };
}, videoId?: string): string[] {
  const t = snippet?.thumbnails;
  const fromApi = [t?.maxres?.url, t?.standard?.url, t?.high?.url, t?.medium?.url].filter(
    (u): u is string => !!u,
  );
  if (fromApi.length >= 2) return fromApi.slice(0, 2);
  if (videoId) {
    return [
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ];
  }
  return fromApi;
}

/**
 * YouTube most-popular — optional YOUTUBE_API_KEY.
 * No-ops cleanly when key is missing (adapter skipped in orchestrator).
 */
export async function fetchYouTubeCandidates(maxResults = 10): Promise<ContentCandidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    part: 'snippet,statistics',
    chart: 'mostPopular',
    regionCode: 'US',
    maxResults: String(maxResults),
    key: apiKey,
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`⚠️  [YouTube] API ${res.status} — check YOUTUBE_API_KEY quota`);
    return [];
  }

  const json = (await res.json()) as YouTubeListResponse;
  const out: ContentCandidate[] = [];

  for (const item of json.items ?? []) {
    const title = item.snippet?.title;
    if (!title) continue;

    const views = Number(item.statistics?.viewCount ?? 0);
    const likes = Number(item.statistics?.likeCount ?? 0);
    const comments = Number(item.statistics?.commentCount ?? 0);
    const publishedAt = item.snippet?.publishedAt;
    const ageHours = publishedAt
      ? (Date.now() - new Date(publishedAt).getTime()) / (3600 * 1000)
      : 48;
    const videoId = item.id;
    const thumbs = youtubeThumbnails(item.snippet, videoId);

    out.push({
      id: `yt_${videoId}`,
      platform: 'youtube',
      title: title.slice(0, 240),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
      description: (item.snippet?.description ?? '').slice(0, 200),
      mediaType: 'video',
      tractionScore: tractionFromYoutube(views, likes, ageHours),
      rawMetrics: { views, score: likes, comments, ageHours },
      entities: extractEntities(title),
      publishedAt,
      imageUrls: thumbs,
    });
  }

  return out.sort((a, b) => b.tractionScore - a.tractionScore);
}
