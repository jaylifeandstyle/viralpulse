import type { FusedCluster } from '../types';
import { applyMediaToCluster } from './media';

const FETCH_TIMEOUT_MS = 6000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ViralPulse/1.0; +https://viralpulse.app)';

/** Cluster has something we can attach to an X post. */
export function hasPostableMedia(cluster: FusedCluster): boolean {
  if (cluster.videoUrl && /\.mp4(\?|$)/i.test(cluster.videoUrl)) return true;
  return (cluster.imageUrls?.length ?? 0) > 0;
}

/** Fill missing images/video from source URLs and news search. */
export async function enrichClusterMedia(cluster: FusedCluster): Promise<FusedCluster> {
  const withMedia = applyMediaToCluster(cluster);
  if (hasPostableMedia(withMedia)) return withMedia;

  const imagePool: string[] = [];
  let videoUrl = withMedia.videoUrl;

  for (const s of cluster.sources) {
    if (s.directVideoUrl && /\.mp4(\?|$)/i.test(s.directVideoUrl)) {
      videoUrl = videoUrl ?? s.directVideoUrl;
    }
    for (const id of youtubeIdsFromUrl(s.url)) {
      imagePool.push(...youtubeThumbnails(id));
    }
    if (s.url && !isLowValueUrl(s.url)) {
      const og = await fetchOgImage(s.url);
      if (og) imagePool.push(og);
    }
  }

  if (cluster.sourceUrl) {
    for (const id of youtubeIdsFromUrl(cluster.sourceUrl)) {
      imagePool.push(...youtubeThumbnails(id));
    }
    if (!isLowValueUrl(cluster.sourceUrl)) {
      const og = await fetchOgImage(cluster.sourceUrl);
      if (og) imagePool.push(og);
    }
  }

  if (imagePool.length === 0) {
    const newsImages = await fetchNewsImagesForTopic(cluster.primaryTitle);
    imagePool.push(...newsImages);
  }

  if (imagePool.length === 0) {
    const wiki = await fetchWikipediaThumbnail(cluster.primaryTitle);
    if (wiki) imagePool.push(wiki);
  }

  if (imagePool.length < 2) {
    imagePool.push(...(await fetchOpenverseImages(cluster.primaryTitle, 2 - imagePool.length)));
  }

  const deduped = dedupeUrls(imagePool).slice(0, 2);
  if (deduped.length === 0 && !videoUrl) return withMedia;

  return {
    ...withMedia,
    imageUrls: deduped.length ? deduped : withMedia.imageUrls,
    videoUrl,
  };
}

/** Resolve post-ready media from topic alone (for backfill / Post Now). */
export async function enrichMediaForTopic(
  topic: string,
  imageSearchQuery?: string,
): Promise<{ imageUrls: string[]; videoUrl?: string }> {
  const queries = uniqueQueries(topic, imageSearchQuery);
  const imagePool: string[] = [];

  // Fast sources first — keeps Post Now modal responsive.
  for (const q of queries) {
    imagePool.push(...(await fetchOpenverseImages(q, 2 - imagePool.length)));
    if (imagePool.length >= 2) break;
  }

  if (imagePool.length < 2) {
    for (const q of queries) {
      const wiki = await fetchWikipediaThumbnail(q);
      if (wiki) imagePool.push(wiki);
      if (imagePool.length >= 2) break;
    }
  }

  if (imagePool.length < 2) {
    for (const q of queries) {
      imagePool.push(...(await fetchNewsImagesForTopic(q, 2 - imagePool.length)));
      if (imagePool.length >= 2) break;
    }
  }

  if (imagePool.length < 2 && imageSearchQuery) {
    imagePool.push(
      ...(await fetchOpenverseImages(headWords(imageSearchQuery, 2), 2 - imagePool.length)),
    );
  }
  if (imagePool.length < 2) {
    imagePool.push(...(await fetchOpenverseImages(headWords(topic, 2), 2 - imagePool.length)));
  }

  const imageUrls = dedupeUrls(imagePool).slice(0, 2);
  return { imageUrls };
}

function headWords(text: string, n: number): string {
  return text.replace(/^#/, '').trim().split(/\s+/).slice(0, n).join(' ');
}

function uniqueQueries(topic: string, imageSearchQuery?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [imageSearchQuery, topic]) {
    const q = raw?.replace(/^#/, '').trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function isLowValueUrl(url: string): boolean {
  return /news\.ycombinator\.com|twitter\.com|x\.com/i.test(url);
}

function youtubeIdsFromUrl(url?: string): string[] {
  if (!url) return [];
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{6,})/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return [m[1]];
  }
  return [];
}

export function youtubeThumbnails(videoId: string): string[] {
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];
}

async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return undefined;
    const html = (await res.text()).slice(0, 120_000);
    return (
      extractMeta(html, 'og:image') ??
      extractMeta(html, 'twitter:image') ??
      extractMeta(html, 'twitter:image:src')
    );
  } catch {
    return undefined;
  }
}

function extractMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  if (m?.[1]) return decodeHtml(m[1]).trim();
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2?.[1] ? decodeHtml(m2[1]).trim() : undefined;
}

async function fetchWikipediaThumbnail(topic: string): Promise<string | undefined> {
  const cleaned = topic.replace(/^#/, '').trim();
  if (!cleaned) return undefined;

  // Prefer opensearch — handles "Fable 5 Is Back" → "Fable 5" etc.
  try {
    const params = new URLSearchParams({
      action: 'opensearch',
      search: cleaned,
      limit: '3',
      namespace: '0',
      format: 'json',
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as [string, string[]];
      for (const title of data[1] ?? []) {
        const thumb = await wikipediaSummaryThumb(title.replace(/ /g, '_'));
        if (thumb) return thumb;
      }
    }
  } catch {
    // fall through to direct title
  }

  return wikipediaSummaryThumb(cleaned.replace(/ /g, '_'));
}

async function fetchOpenverseImages(query: string, max = 2): Promise<string[]> {
  if (!query.trim() || max <= 0) return [];
  try {
    const params = new URLSearchParams({
      q: query.trim(),
      page_size: String(Math.min(max, 15)),
    });
    const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{ url?: string; mature?: boolean }>;
    };
    return (json.results ?? [])
      .filter((r) => r.url && !r.mature && isValidImageUrl(r.url))
      .map((r) => r.url!)
      .slice(0, max);
  } catch {
    return [];
  }
}

async function wikipediaSummaryThumb(title: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    const src = data.thumbnail?.source;
    return src && isValidImageUrl(src) ? src : undefined;
  } catch {
    return undefined;
  }
}

async function fetchNewsImagesForTopic(topic: string, max = 2): Promise<string[]> {
  const cleaned = topic.replace(/^#/, '').trim();
  if (!cleaned) return [];

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleaned)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return await imagesFromGoogleNewsRss(xml, max);
  } catch {
    return [];
  }
}

async function imagesFromGoogleNewsRss(xml: string, max: number): Promise<string[]> {
  const out: string[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null && out.length < max) {
    const block = match[1];
    const desc = extractTag(block, 'description') ?? '';
    const imgFromDesc = desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
    if (imgFromDesc && isValidImageUrl(imgFromDesc)) {
      out.push(decodeHtml(imgFromDesc));
      continue;
    }
    const link = extractTag(block, 'link');
    if (link && !isLowValueUrl(link)) {
      const og = await fetchOgImage(link);
      if (og && isValidImageUrl(og)) out.push(og);
    }
  }

  return dedupeUrls(out).slice(0, max);
}

function extractTag(xml: string, tag: string): string | null {
  const cdataRe = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1];
  const normalRe = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const normalMatch = xml.match(normalRe);
  return normalMatch ? normalMatch[1] : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isValidImageUrl(url: string): boolean {
  return (
    /^https?:\/\//i.test(url) &&
    !/placeholder|1x1|pixel\.gif|spacer/i.test(url) &&
    !/\/default\.(jpg|png)/i.test(url)
  );
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.replace(/&amp;/g, '&').trim();
    const key = url.split('?')[0];
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
