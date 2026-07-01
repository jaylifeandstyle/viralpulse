const NEWS_FETCH_TIMEOUT_MS = 6000;

export type BbcCategory = 'WORLD' | 'BUSINESS' | 'TECHNOLOGY' | 'ENTERTAINMENT';

export type BbcStory = {
  source: 'bbc';
  category: BbcCategory;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  imageUrl?: string;
};

const BBC_CATEGORY_PATHS: Record<BbcCategory, string> = {
  WORLD: 'news/world',
  BUSINESS: 'news/business',
  TECHNOLOGY: 'news/technology',
  ENTERTAINMENT: 'news/entertainment_and_arts',
};

function bbcRssUrl(category: BbcCategory): string {
  return `https://feeds.bbci.co.uk/${BBC_CATEGORY_PATHS[category]}/rss.xml`;
}

export async function fetchBbcCategory(
  category: BbcCategory,
  maxItems: number,
): Promise<BbcStory[]> {
  try {
    const res = await fetch(bbcRssUrl(category), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), category, maxItems);
  } catch {
    return [];
  }
}

export function diversifyStories(
  fetched: BbcStory[][],
  perCategoryPick: number,
  maxStories: number,
): BbcStory[] {
  const out: BbcStory[] = [];
  for (let i = 0; i < perCategoryPick && out.length < maxStories; i++) {
    for (const bucket of fetched) {
      if (out.length >= maxStories) break;
      const candidate = bucket[i];
      if (candidate && !isDuplicateTitle(candidate, out)) out.push(candidate);
    }
  }
  return out;
}

function isDuplicateTitle(candidate: BbcStory, accepted: BbcStory[]): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 6)
      .join(' ');
  const candidateKey = key(candidate.title);
  if (!candidateKey) return false;
  return accepted.some((s) => key(s.title) === candidateKey);
}

function parseRssItems(xml: string, category: BbcCategory, maxItems: number): BbcStory[] {
  const items: BbcStory[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const title = extractTag(block, 'title');
    if (!title) continue;
    items.push({
      source: 'bbc',
      category,
      title: decodeHtml(title).slice(0, 240),
      description: decodeHtml(extractTag(block, 'description') ?? '').slice(0, 280),
      link: decodeHtml(extractTag(block, 'link') ?? '').slice(0, 400),
      pubDate: (extractTag(block, 'pubDate') ?? '').slice(0, 32),
      imageUrl: extractMediaThumbnail(block),
    });
  }
  return items;
}

function extractMediaThumbnail(itemBlock: string): string | undefined {
  const m = itemBlock.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (!m) return undefined;
  return decodeHtml(m[1]).replace(/\/ace\/standard\/\d+\//, '/ace/standard/800/');
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
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
