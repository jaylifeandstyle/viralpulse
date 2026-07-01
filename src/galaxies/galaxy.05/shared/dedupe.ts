import type { StoredOpportunity } from '@/store/opportunity-store';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'will',
  'says', 'after', 'over', 'into', 'about', 'their', 'what', 'when', 'where',
  'who', 'how', 'new', 'news', 'trending',
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

export function topicsSimilar(a: string, b: string): boolean {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.length === 0 || kb.length === 0) return false;
  const overlap = ka.filter((k) => kb.some((bk) => bk.includes(k) || k.includes(bk)));
  const minLen = Math.min(ka.length, kb.length);
  return overlap.length >= Math.max(2, Math.ceil(minLen * 0.5));
}

export function isTopicAlreadyCovered(topic: string, existing: StoredOpportunity[]): boolean {
  return existing.some((o) => topicsSimilar(topic, o.topic));
}

export function slugify(text: string, max = 32): string {
  return text.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, max);
}
