import type { ContentCandidate } from '../types';
import { extractEntities } from '../shared/keywords';
import { youtubeThumbnails } from '../shared/enrich-media';

const HN_API = 'https://hacker-news.firebaseio.com/v0';
const FETCH_TIMEOUT_MS = 8000;

type HnItem = {
  id?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  time?: number;
  type?: string;
};

function tractionFromHn(score: number, comments: number, ageHours: number): number {
  const velocity = (score + comments * 3) / Math.max(ageHours, 0.25);
  return Math.min(100, Math.round(velocity / 5));
}

async function fetchHnItem(id: number): Promise<HnItem | null> {
  try {
    const res = await fetch(`${HN_API}/item/${id}.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as HnItem;
  } catch {
    return null;
  }
}

/** Hacker News top stories — free, no key. */
export async function fetchHackerNewsCandidates(maxItems = 15): Promise<ContentCandidate[]> {
  const listRes = await fetch(`${HN_API}/topstories.json`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!listRes.ok) return [];

  const ids = ((await listRes.json()) as number[]).slice(0, maxItems);
  const items = await Promise.all(ids.map(fetchHnItem));

  const out: ContentCandidate[] = [];
  for (const item of items) {
    if (!item?.title || item.type !== 'story') continue;

    const ageHours = item.time ? (Date.now() / 1000 - item.time) / 3600 : 24;
    const score = item.score ?? 0;
    const comments = item.descendants ?? 0;
    if (score < 30) continue;

    const url = item.url ?? `https://news.ycombinator.com/item?id=${item.id}`;
    const ytMatch = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{6,})/i,
    );
    const isVideo = !!ytMatch || /vimeo\.com/i.test(url);
    const imageUrls = ytMatch ? youtubeThumbnails(ytMatch[1]) : undefined;

    out.push({
      id: `hn_${item.id}`,
      platform: 'hackernews',
      title: item.title.slice(0, 240),
      url,
      description: `${score} pts · ${comments} comments on HN`,
      mediaType: isVideo ? 'video' : 'link',
      tractionScore: tractionFromHn(score, comments, ageHours),
      rawMetrics: { score, comments, ageHours },
      entities: extractEntities(item.title),
      publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
      imageUrls,
    });
  }

  return out.sort((a, b) => b.tractionScore - a.tractionScore);
}
