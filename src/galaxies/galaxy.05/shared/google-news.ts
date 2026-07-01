const NEWS_FETCH_TIMEOUT_MS = 5000;

export type NewsContextItem = {
  source: 'google-news';
  title: string;
  description: string;
  pubDate: string;
};

export async function fetchNewsContext(topic: string, maxItems = 3): Promise<NewsContextItem[]> {
  const cleaned = topic.replace(/^#/, '').trim();
  if (!cleaned) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleaned)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseGoogleRss(await res.text(), maxItems);
  } catch {
    return [];
  }
}

function parseGoogleRss(xml: string, maxItems: number): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const title = extractTag(block, 'title');
    if (!title) continue;
    items.push({
      source: 'google-news',
      title: decodeHtml(title).slice(0, 200),
      description: decodeHtml(extractTag(block, 'description') ?? '').slice(0, 240),
      pubDate: (extractTag(block, 'pubDate') ?? '').slice(0, 32),
    });
  }
  return items;
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
