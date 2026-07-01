import type { ContentCandidate, FusedCluster } from '../types';

const MAX_IMAGES = 2;

function normalizeImageUrl(url: string): string {
  return url.replace(/&amp;/g, '&').trim();
}

function isValidImageUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url) && !/default|self|nsfw|spoiler|placeholder|1x1|pixel/i.test(url);
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = normalizeImageUrl(raw);
    const key = url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** Higher = more likely to stop the scroll on X. */
function scoreImageEngagement(url: string, sourceTraction: number): number {
  let score = sourceTraction;
  if (/maxres|1920|1280|2048/i.test(url)) score += 30;
  else if (/hqdefault|high|preview|1200/i.test(url)) score += 22;
  else if (/medium|sddefault|640/i.test(url)) score += 12;
  if (/\.gif(\?|$)/i.test(url)) score += 10;
  if (/i\.redd\.it|preview\.redd\.it/i.test(url)) score += 15;
  if (/ytimg\.com/i.test(url)) score += 12;
  if (/thumb|icon|avatar|small/i.test(url)) score -= 25;
  return score;
}

type ScoredImage = { url: string; score: number };

function collectScoredImages(cluster: FusedCluster): ScoredImage[] {
  const scored: ScoredImage[] = [];

  for (const s of cluster.sources) {
    const traction = s.tractionScore;
    for (const img of s.imageUrls ?? []) {
      if (isValidImageUrl(img)) {
        scored.push({ url: img, score: scoreImageEngagement(img, traction) });
      }
    }
    if (s.mediaType === 'image' && isValidImageUrl(s.url)) {
      scored.push({ url: s.url, score: scoreImageEngagement(s.url, traction) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function pickTopImages(scored: ScoredImage[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { url } of scored) {
    const key = url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Pick up to 2 distinct images + optional direct video from a fused cluster. */
export function buildMediaFromCluster(cluster: FusedCluster): {
  imageUrls: string[];
  videoUrl?: string;
} {
  const scoredImages = collectScoredImages(cluster);
  let directVideo: string | undefined;

  for (const s of cluster.sources) {
    if (s.directVideoUrl && /\.mp4(\?|$)/i.test(s.directVideoUrl)) {
      directVideo = directVideo ?? s.directVideoUrl;
    }
  }

  // Prefer highest-traction source with a direct clip.
  const videoSource = [...cluster.sources]
    .filter((s) => s.directVideoUrl && /\.mp4(\?|$)/i.test(s.directVideoUrl))
    .sort((a, b) => b.tractionScore - a.tractionScore)[0];
  if (videoSource?.directVideoUrl) {
    directVideo = videoSource.directVideoUrl;
  }

  const images = pickTopImages(scoredImages, MAX_IMAGES);
  const hasDirectVideo = !!directVideo;
  const isVideoCluster = cluster.dominantMediaType === 'video' || hasDirectVideo;

  if (isVideoCluster && hasDirectVideo) {
    const companion =
      images.find((u) => !u.includes('v.redd.it')) ??
      pickTopImages(scoredImages, 1)[0];
    return {
      videoUrl: directVideo,
      imageUrls: companion ? [companion] : [],
    };
  }

  if (isVideoCluster) {
    return { imageUrls: pickTopImages(scoredImages, MAX_IMAGES) };
  }

  return { imageUrls: images };
}

export function applyMediaToCluster(cluster: FusedCluster): FusedCluster {
  const media = buildMediaFromCluster(cluster);
  return { ...cluster, imageUrls: media.imageUrls, videoUrl: media.videoUrl };
}

/** Boost for ranking clusters that ship with post-ready media. */
export function mediaEngagementBoost(cluster: FusedCluster): number {
  if (cluster.videoUrl && /\.mp4(\?|$)/i.test(cluster.videoUrl)) return 40;
  const imgs = cluster.imageUrls?.length ?? 0;
  if (imgs >= 2) return 32;
  if (imgs >= 1) return 18;
  if (cluster.dominantMediaType === 'video') return 12;
  if (cluster.dominantMediaType === 'image') return 8;
  return 0;
}
